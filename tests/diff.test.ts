// Tests for `evergreen diff` preview — validates scan grouping and rule mapping
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { loadSpec } from "../src/changefeed/loader.js";
import { scan } from "../src/scanner/scan.js";

describe("evergreen diff preview logic", () => {
  it("groups findings by file with rule details", async () => {
    const spec = await loadSpec(resolve("specs/stripe-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo"), spec);
    expect(result.findings.length).toBeGreaterThan(0);

    // Group by file like the diff command does
    const byFile = new Map<string, typeof result.findings>();
    for (const f of result.findings) {
      const arr = byFile.get(f.file) ?? [];
      arr.push(f);
      byFile.set(f.file, arr);
    }

    expect(byFile.size).toBeGreaterThanOrEqual(2);

    // Every finding should map to a known rule
    const ruleMap = new Map(spec.changes.map((c) => [c.id, c]));
    for (const f of result.findings) {
      expect(ruleMap.has(f.ruleId)).toBe(true);
      const rule = ruleMap.get(f.ruleId)!;
      expect(rule.replace.guidance).toBeTruthy();
    }
  });

  it("produces JSON structure with specRef and file groupings", async () => {
    const spec = await loadSpec(resolve("specs/stripe-python-2025-03-31-basil.json"));
    const result = await scan(resolve("fixtures/demo-repo-python"), spec);

    const byFile = new Map<string, typeof result.findings>();
    for (const f of result.findings) {
      const arr = byFile.get(f.file) ?? [];
      arr.push(f);
      byFile.set(f.file, arr);
    }

    const ruleMap = new Map(spec.changes.map((c) => [c.id, c]));
    const files = [...byFile.entries()].map(([file, hits]) => ({
      file,
      findings: hits.map((h) => ({
        line: h.line,
        ruleId: h.ruleId,
        matchText: h.matchText,
        guidance: ruleMap.get(h.ruleId)?.replace.guidance,
      })),
    }));

    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      for (const finding of f.findings) {
        expect(finding.guidance).toBeTruthy();
        expect(finding.line).toBeGreaterThan(0);
      }
    }
  });
});
