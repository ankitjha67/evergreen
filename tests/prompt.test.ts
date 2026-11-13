// FR-04.2/04.3 — prompt assembly contract
import { describe, it, expect } from "vitest";
import { buildMigrationPrompt, MANIFEST_RELPATH } from "../src/migrator/prompt.js";
import { parseVerdicts } from "../src/triage/triage.js";
import { BreakingChangeSpec, Finding } from "../src/types.js";

const spec: BreakingChangeSpec = {
  specVersion: "1",
  vendor: "stripe",
  api: "stripe-node",
  version: "2025-03-31.basil",
  title: "Basil changes",
  languages: ["javascript"],
  changes: [
    {
      id: "rule-a",
      severity: "breaking",
      title: "A",
      description: "descA",
      detect: { patterns: ["a\\("], filePatterns: ["**/*.js"] },
      replace: { guidance: "replace a with b", before: "a()", after: "b()" },
    },
    {
      id: "rule-unused",
      severity: "deprecation",
      title: "U",
      description: "descU",
      detect: { patterns: ["u\\("], filePatterns: ["**/*.js"] },
      replace: { guidance: "unused" },
    },
  ],
};

const findings: Finding[] = [
  { ruleId: "rule-a", file: "src/x.js", line: 3, column: 1, matchText: "a(", lineText: "a(1)" },
];

describe("FR-04 prompt", () => {
  it("contains work list, used rules only, manifest path, and the hard contract", () => {
    const p = buildMigrationPrompt(spec, findings);
    expect(p).toContain("src/x.js");
    expect(p).toContain("line 3 [rule-a]");
    expect(p).toContain("rule-a — A");
    expect(p).not.toContain("rule-unused"); // only rules with findings are included
    expect(p).toContain(MANIFEST_RELPATH);
    expect(p).toContain("Edit ONLY files in the work list");
    expect(p).toContain("Preserve whitespace and operator spacing"); // v1.1 rule 6
    expect(p).toContain("stripe@2025-03-31.basil");
  });
});

describe("FR-03.2 verdict parsing", () => {
  it("parses a valid verdict array (order-independent via i)", () => {
    const v = parseVerdicts(`noise [{"i":1,"verdict":"not_affected","reason":"new api"},{"i":0,"verdict":"affected","reason":"old api"}] trailing`, 2);
    expect(v).not.toBeNull();
    expect(v![0].verdict).toBe("affected");
    expect(v![1].verdict).toBe("not_affected");
  });

  it("rejects wrong length, bad verdicts, and garbage", () => {
    expect(parseVerdicts(`[{"i":0,"verdict":"affected","reason":""}]`, 2)).toBeNull();
    expect(parseVerdicts(`[{"i":0,"verdict":"maybe","reason":""}]`, 1)).toBeNull();
    expect(parseVerdicts(`no json here`, 1)).toBeNull();
  });
});
