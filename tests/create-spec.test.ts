import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { mkdir, rm, readFile } from "node:fs/promises";
import {
  buildSpec,
  validateWizardInput,
  validateRulePatterns,
  writeSpec,
  specFromJson,
  type SpecWizardInput,
} from "../src/create-spec.js";

const TMP = resolve("test-tmp-create-spec");

const validInput: SpecWizardInput = {
  vendor: "acme",
  api: "acme-sdk",
  version: "2.0.0",
  title: "Acme SDK v2 breaking changes",
  languages: ["javascript", "typescript"],
  rules: [
    {
      severity: "breaking",
      title: "Widget.create removed",
      patterns: ["Widget\\.create"],
      guidance: "Use Widget.build instead",
      before: "Widget.create(opts)",
      after: "Widget.build(opts)",
    },
    {
      severity: "deprecation",
      title: "Config.legacy deprecated",
      patterns: ["Config\\.legacy"],
      guidance: "Use Config.modern",
    },
  ],
};

describe("validateWizardInput", () => {
  it("validates correct input", () => {
    const errors = validateWizardInput(validInput);
    expect(errors).toHaveLength(0);
  });

  it("rejects invalid vendor slug", () => {
    const errors = validateWizardInput({ ...validInput, vendor: "Acme Corp!" });
    expect(errors.some((e) => e.includes("vendor"))).toBe(true);
  });

  it("rejects invalid api slug", () => {
    const errors = validateWizardInput({ ...validInput, api: "Acme SDK" });
    expect(errors.some((e) => e.includes("api"))).toBe(true);
  });

  it("rejects empty languages", () => {
    const errors = validateWizardInput({ ...validInput, languages: [] });
    expect(errors.some((e) => e.includes("language"))).toBe(true);
  });

  it("rejects empty rules", () => {
    const errors = validateWizardInput({ ...validInput, rules: [] });
    expect(errors.some((e) => e.includes("rule"))).toBe(true);
  });

  it("rejects invalid regex patterns", () => {
    const input = {
      ...validInput,
      rules: [{ ...validInput.rules[0], patterns: ["[invalid(regex"] }],
    };
    const errors = validateWizardInput(input);
    expect(errors.some((e) => e.includes("Invalid regex"))).toBe(true);
  });

  it("rejects invalid deadline format", () => {
    const errors = validateWizardInput({ ...validInput, deadline: "not-a-date" });
    expect(errors.some((e) => e.includes("deadline"))).toBe(true);
  });
});

describe("validateRulePatterns", () => {
  it("accepts valid regex patterns", () => {
    expect(validateRulePatterns(["foo\\.bar", "baz\\("])).toHaveLength(0);
  });

  it("rejects invalid regex patterns", () => {
    const errors = validateRulePatterns(["[bad"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Invalid regex");
  });
});

describe("buildSpec", () => {
  it("builds a valid BreakingChangeSpec", () => {
    const spec = buildSpec(validInput);
    expect(spec.specVersion).toBe("1");
    expect(spec.vendor).toBe("acme");
    expect(spec.api).toBe("acme-sdk");
    expect(spec.version).toBe("2.0.0");
    expect(spec.title).toBe("Acme SDK v2 breaking changes");
    expect(spec.languages).toEqual(["javascript", "typescript"]);
    expect(spec.changes).toHaveLength(2);
  });

  it("generates rule IDs when not provided", () => {
    const spec = buildSpec(validInput);
    expect(spec.changes[0].id).toBe("acme-001");
    expect(spec.changes[1].id).toBe("acme-002");
  });

  it("uses custom rule IDs when provided", () => {
    const input = {
      ...validInput,
      rules: [{ ...validInput.rules[0], id: "custom-id" }],
    };
    const spec = buildSpec(input);
    expect(spec.changes[0].id).toBe("custom-id");
  });

  it("infers file patterns from languages", () => {
    const spec = buildSpec(validInput);
    const fp = spec.changes[0].detect.filePatterns;
    expect(fp).toContain("**/*.js");
    expect(fp).toContain("**/*.ts");
    expect(fp).toContain("**/*.tsx");
  });

  it("generates default title when not provided", () => {
    const input = { ...validInput, title: undefined };
    const spec = buildSpec(input);
    expect(spec.title).toContain("acme-sdk");
    expect(spec.title).toContain("2.0.0");
  });
});

describe("writeSpec", () => {
  it("writes spec to a file", async () => {
    await mkdir(TMP, { recursive: true });
    const spec = buildSpec(validInput);
    const outPath = join(TMP, "test-spec.json");
    await writeSpec(spec, outPath);

    const raw = await readFile(outPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.vendor).toBe("acme");
    expect(parsed.changes).toHaveLength(2);

    await rm(TMP, { recursive: true, force: true });
  });
});

describe("specFromJson", () => {
  it("imports from JSON string", () => {
    const spec = buildSpec(validInput);
    const json = JSON.stringify(spec);
    const imported = specFromJson(json);
    expect(imported.vendor).toBe("acme");
    expect(imported.rules).toHaveLength(2);
    expect(imported.rules[0].patterns).toContain("Widget\\.create");
    expect(imported.rules[0].guidance).toBe("Use Widget.build instead");
  });
});
