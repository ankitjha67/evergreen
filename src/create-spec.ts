// Spec authoring wizard - guided creation of changefeed specs
import { writeFile } from "node:fs/promises";
import { BreakingChangeSpec, ChangeRule } from "./types.js";

export interface SpecWizardInput {
  vendor: string;
  api: string;
  version: string;
  title?: string;
  docsUrl?: string;
  deadline?: string;
  languages: string[];
  rules: RuleInput[];
}

export interface RuleInput {
  id?: string;
  severity: "breaking" | "deprecation" | "behavioral";
  title: string;
  description?: string;
  patterns: string[];
  filePatterns?: string[];
  guidance: string;
  before?: string;
  after?: string;
  docsUrl?: string;
}

function generateRuleId(vendor: string, index: number): string {
  return `${vendor}-${String(index + 1).padStart(3, "0")}`;
}

function inferFilePatterns(languages: string[]): string[] {
  const langPatterns: Record<string, string[]> = {
    javascript: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    typescript: ["**/*.ts", "**/*.tsx"],
    python: ["**/*.py"],
    ruby: ["**/*.rb"],
    go: ["**/*.go"],
    java: ["**/*.java"],
    csharp: ["**/*.cs"],
    php: ["**/*.php"],
    rust: ["**/*.rs"],
    swift: ["**/*.swift"],
    kotlin: ["**/*.kt"],
  };

  const patterns: string[] = [];
  for (const lang of languages) {
    const lp = langPatterns[lang.toLowerCase()];
    if (lp) patterns.push(...lp);
  }
  return patterns.length > 0 ? patterns : ["**/*"];
}

export function validateRulePatterns(patterns: string[]): string[] {
  const errors: string[] = [];
  for (const p of patterns) {
    try {
      new RegExp(p);
    } catch (e: any) {
      errors.push(`Invalid regex "${p}": ${e.message}`);
    }
  }
  return errors;
}

export function buildSpec(input: SpecWizardInput): BreakingChangeSpec {
  const defaultFilePatterns = inferFilePatterns(input.languages);

  const changes: ChangeRule[] = input.rules.map((rule, i) => {
    const id = rule.id ?? generateRuleId(input.vendor, i);
    return {
      id,
      severity: rule.severity,
      title: rule.title,
      description: rule.description ?? rule.title,
      detect: {
        patterns: rule.patterns,
        filePatterns: rule.filePatterns ?? defaultFilePatterns,
      },
      replace: {
        guidance: rule.guidance,
        before: rule.before,
        after: rule.after,
        docsUrl: rule.docsUrl,
      },
    };
  });

  return {
    specVersion: "1",
    vendor: input.vendor,
    api: input.api,
    version: input.version,
    title: input.title ?? `${input.api} ${input.version} breaking changes`,
    docsUrl: input.docsUrl,
    deadline: input.deadline,
    languages: input.languages,
    changes,
  };
}

export function validateWizardInput(input: SpecWizardInput): string[] {
  const errors: string[] = [];

  if (!input.vendor || !/^[a-z0-9-]+$/.test(input.vendor)) {
    errors.push("vendor must be lowercase alphanumeric with hyphens (e.g. 'stripe', 'twilio')");
  }
  if (!input.api || !/^[a-z0-9-]+$/.test(input.api)) {
    errors.push("api must be lowercase alphanumeric with hyphens (e.g. 'stripe-node', 'twilio-python')");
  }
  if (!input.version) {
    errors.push("version is required (e.g. '2025-03-31', 'v4')");
  }
  if (!input.languages || input.languages.length === 0) {
    errors.push("at least one language is required");
  }
  if (!input.rules || input.rules.length === 0) {
    errors.push("at least one rule is required");
  }

  for (const [i, rule] of (input.rules ?? []).entries()) {
    if (!rule.title) errors.push(`rule[${i}]: title is required`);
    if (!rule.patterns || rule.patterns.length === 0) {
      errors.push(`rule[${i}]: at least one detection pattern is required`);
    } else {
      const patternErrors = validateRulePatterns(rule.patterns);
      for (const pe of patternErrors) errors.push(`rule[${i}]: ${pe}`);
    }
    if (!rule.guidance) errors.push(`rule[${i}]: guidance is required`);
    if (!rule.severity) errors.push(`rule[${i}]: severity is required`);
  }

  if (input.deadline) {
    const d = new Date(input.deadline);
    if (isNaN(d.getTime())) {
      errors.push("deadline must be a valid ISO date (e.g. '2026-12-31')");
    }
  }

  return errors;
}

export async function writeSpec(spec: BreakingChangeSpec, outPath: string): Promise<void> {
  const json = JSON.stringify(spec, null, 2) + "\n";
  await writeFile(outPath, json, "utf8");
}

export function specFromJson(jsonStr: string): SpecWizardInput {
  const raw = JSON.parse(jsonStr);
  return {
    vendor: raw.vendor ?? "",
    api: raw.api ?? "",
    version: raw.version ?? "",
    title: raw.title,
    docsUrl: raw.docsUrl,
    deadline: raw.deadline,
    languages: raw.languages ?? [],
    rules: (raw.changes ?? []).map((c: any) => ({
      id: c.id,
      severity: c.severity ?? "breaking",
      title: c.title ?? "",
      description: c.description,
      patterns: c.detect?.patterns ?? [],
      filePatterns: c.detect?.filePatterns,
      guidance: c.replace?.guidance ?? "",
      before: c.replace?.before,
      after: c.replace?.after,
      docsUrl: c.replace?.docsUrl,
    })),
  };
}
