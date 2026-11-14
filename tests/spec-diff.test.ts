import { describe, it, expect } from "vitest";
import { diffSpecs, formatSpecDiff, type SpecDiff } from "../src/spec-diff.js";
import { BreakingChangeSpec } from "../src/types.js";

const makeSpec = (overrides?: Partial<BreakingChangeSpec>): BreakingChangeSpec => ({
  specVersion: "1",
  vendor: "acme",
  api: "acme-sdk",
  version: "1.0.0",
  title: "Acme SDK v1 breaking changes",
  languages: ["javascript"],
  changes: [
    {
      id: "acme-001",
      severity: "breaking",
      title: "Widget.create removed",
      description: "Widget.create was removed in v2",
      detect: { patterns: ["Widget\\.create"], filePatterns: ["**/*.js"] },
      replace: { guidance: "Use Widget.build instead", before: "Widget.create()", after: "Widget.build()" },
    },
    {
      id: "acme-002",
      severity: "deprecation",
      title: "Config.legacy deprecated",
      description: "Config.legacy is deprecated",
      detect: { patterns: ["Config\\.legacy"], filePatterns: ["**/*.js"] },
      replace: { guidance: "Use Config.modern" },
    },
  ],
  ...overrides,
});

describe("diffSpecs", () => {
  it("detects identical specs", () => {
    const spec = makeSpec();
    const diff = diffSpecs(spec, spec);
    expect(diff.rules.added).toHaveLength(0);
    expect(diff.rules.removed).toHaveLength(0);
    expect(diff.rules.changed).toHaveLength(0);
    expect(diff.rules.unchanged).toBe(2);
    expect(diff.summary).toContain("No differences");
  });

  it("detects added rules", () => {
    const before = makeSpec();
    const after = makeSpec({
      version: "2.0.0",
      changes: [
        ...before.changes,
        {
          id: "acme-003",
          severity: "breaking",
          title: "New breaking change",
          description: "desc",
          detect: { patterns: ["NewAPI"], filePatterns: ["**/*.js"] },
          replace: { guidance: "Use NewerAPI" },
        },
      ],
    });

    const diff = diffSpecs(before, after);
    expect(diff.rules.added).toHaveLength(1);
    expect(diff.rules.added[0].ruleId).toBe("acme-003");
    expect(diff.rules.removed).toHaveLength(0);
    expect(diff.rules.unchanged).toBe(2);
  });

  it("detects removed rules", () => {
    const before = makeSpec();
    const after = makeSpec({ version: "2.0.0", changes: [before.changes[0]] });

    const diff = diffSpecs(before, after);
    expect(diff.rules.removed).toHaveLength(1);
    expect(diff.rules.removed[0].ruleId).toBe("acme-002");
    expect(diff.rules.added).toHaveLength(0);
    expect(diff.rules.unchanged).toBe(1);
  });

  it("detects changed rules", () => {
    const before = makeSpec();
    const after = makeSpec({
      version: "2.0.0",
      changes: [
        { ...before.changes[0], severity: "deprecation" as const },
        before.changes[1],
      ],
    });

    const diff = diffSpecs(before, after);
    expect(diff.rules.changed).toHaveLength(1);
    expect(diff.rules.changed[0].ruleId).toBe("acme-001");
    expect(diff.rules.changed[0].changes).toContain("severity: breaking -> deprecation");
    expect(diff.rules.unchanged).toBe(1);
  });

  it("detects metadata changes", () => {
    const before = makeSpec();
    const after = makeSpec({ title: "New Title", deadline: "2026-12-31" });

    const diff = diffSpecs(before, after);
    expect(diff.metadataChanges).toContain('title: "Acme SDK v1 breaking changes" -> "New Title"');
    expect(diff.metadataChanges.some((c) => c.includes("deadline"))).toBe(true);
  });

  it("detects language changes", () => {
    const before = makeSpec({ languages: ["javascript"] });
    const after = makeSpec({ languages: ["javascript", "typescript"] });

    const diff = diffSpecs(before, after);
    expect(diff.metadataChanges.some((c) => c.includes("languages added: typescript"))).toBe(true);
  });

  it("detects pattern changes within a rule", () => {
    const before = makeSpec();
    const after = makeSpec({
      changes: [
        {
          ...before.changes[0],
          detect: { patterns: ["Widget\\.build"], filePatterns: ["**/*.js"] },
        },
        before.changes[1],
      ],
    });

    const diff = diffSpecs(before, after);
    expect(diff.rules.changed).toHaveLength(1);
    expect(diff.rules.changed[0].changes).toContain("detect patterns changed");
  });

  it("detects guidance changes", () => {
    const before = makeSpec();
    const after = makeSpec({
      changes: [
        {
          ...before.changes[0],
          replace: { guidance: "Different guidance", before: "Widget.create()", after: "Widget.build()" },
        },
        before.changes[1],
      ],
    });

    const diff = diffSpecs(before, after);
    expect(diff.rules.changed).toHaveLength(1);
    expect(diff.rules.changed[0].changes).toContain("guidance changed");
  });
});

describe("formatSpecDiff", () => {
  it("formats empty diff", () => {
    const spec = makeSpec();
    const diff = diffSpecs(spec, spec);
    const formatted = formatSpecDiff(diff);
    expect(formatted).toContain("No differences");
    expect(formatted).toContain("Spec Diff:");
  });

  it("formats diff with all change types", () => {
    const diff: SpecDiff = {
      beforeRef: "acme@acme-sdk@1.0.0",
      afterRef: "acme@acme-sdk@2.0.0",
      metadataChanges: ["title changed"],
      rules: {
        added: [{ ruleId: "new-001", status: "added", title: "New rule", after: { severity: "breaking" } as any }],
        removed: [{ ruleId: "old-001", status: "removed", title: "Old rule", before: { severity: "deprecation" } as any }],
        changed: [{ ruleId: "mod-001", status: "changed", title: "Modified", changes: ["severity changed"] }],
        unchanged: 3,
      },
      summary: "3 rule change(s): 1 added, 1 removed, 1 modified, 3 unchanged.",
    };

    const formatted = formatSpecDiff(diff);
    expect(formatted).toContain("Added rules:");
    expect(formatted).toContain("+ [breaking] new-001");
    expect(formatted).toContain("Removed rules:");
    expect(formatted).toContain("- [deprecation] old-001");
    expect(formatted).toContain("Modified rules:");
    expect(formatted).toContain("~ mod-001");
    expect(formatted).toContain("severity changed");
  });
});
