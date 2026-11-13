// FR-01.2 — spec validation
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSpec, validateSpec } from "../src/changefeed/loader.js";
import { SpecValidationError } from "../src/types.js";

const validSpec = {
  specVersion: "1",
  vendor: "stripe",
  api: "stripe-node",
  version: "2025-03-31.basil",
  title: "t",
  languages: ["javascript"],
  changes: [
    {
      id: "r1",
      severity: "breaking",
      title: "t",
      description: "d",
      detect: { patterns: ["foo\\("], filePatterns: ["**/*.js"] },
      replace: { guidance: "g" },
    },
  ],
};

describe("FR-01 loader", () => {
  it("loads a valid spec from disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eg-spec-"));
    const p = join(dir, "spec.json");
    await writeFile(p, JSON.stringify(validSpec));
    const spec = await loadSpec(p);
    expect(spec.vendor).toBe("stripe");
    expect(spec.changes).toHaveLength(1);
  });

  it("rejects non-JSON with a SpecValidationError", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eg-spec-"));
    const p = join(dir, "bad.json");
    await writeFile(p, "{nope");
    await expect(loadSpec(p)).rejects.toBeInstanceOf(SpecValidationError);
  });

  it("flags duplicate rule ids", () => {
    const s = structuredClone(validSpec) as any;
    s.changes.push(structuredClone(s.changes[0]));
    const problems = validateSpec(s);
    expect(problems.some((p) => p.includes('"r1" is duplicated'))).toBe(true);
  });

  it("flags invalid regex patterns", () => {
    const s = structuredClone(validSpec) as any;
    s.changes[0].detect.patterns = ["(unclosed"];
    const problems = validateSpec(s);
    expect(problems.some((p) => p.includes("not a valid regex"))).toBe(true);
  });

  it("flags missing required fields and bad severity", () => {
    const s = structuredClone(validSpec) as any;
    delete s.vendor;
    s.changes[0].severity = "huge";
    const problems = validateSpec(s);
    expect(problems.some((p) => p.includes("vendor is required"))).toBe(true);
    expect(problems.some((p) => p.includes("severity"))).toBe(true);
  });
});
