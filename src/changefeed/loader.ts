// FR-01 - Changefeed loader: parse + validate BreakingChangeSpec (FSD.md FR-01.1/01.2)
import { readFile } from "node:fs/promises";
import { BreakingChangeSpec, SpecValidationError } from "../types.js";

export async function loadSpec(path: string): Promise<BreakingChangeSpec> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new SpecValidationError([`${path}: cannot read file`]);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new SpecValidationError([`${path}: not valid JSON (${(e as Error).message})`]);
  }

  const problems = validateSpec(data, path);
  if (problems.length > 0) throw new SpecValidationError(problems);
  return data as BreakingChangeSpec;
}

const SEVERITIES = new Set(["breaking", "deprecation", "behavioral"]);

export function validateSpec(data: unknown, src = "spec"): string[] {
  const problems: string[] = [];
  const p = (msg: string) => problems.push(`${src}: ${msg}`);

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [`${src}: spec must be a JSON object`];
  }
  const s = data as Record<string, unknown>;

  if (s.specVersion !== "1") p(`specVersion must be "1"`);
  for (const field of ["vendor", "api", "version", "title"] as const) {
    if (typeof s[field] !== "string" || (s[field] as string).length === 0) p(`${field} is required (non-empty string)`);
  }
  if (typeof s.vendor === "string" && !/^[a-z0-9-]+$/.test(s.vendor)) p(`vendor must match [a-z0-9-]+`);
  if (!Array.isArray(s.languages) || s.languages.length === 0) p(`languages must be a non-empty array`);

  if (!Array.isArray(s.changes) || s.changes.length === 0) {
    p(`changes must be a non-empty array`);
    return problems;
  }

  const ids = new Set<string>();
  s.changes.forEach((c: unknown, i: number) => {
    const where = `changes[${i}]`;
    if (typeof c !== "object" || c === null) {
      p(`${where} must be an object`);
      return;
    }
    const r = c as Record<string, any>;
    if (typeof r.id !== "string" || r.id.length === 0) p(`${where}.id is required`);
    else if (ids.has(r.id)) p(`${where}.id "${r.id}" is duplicated`);
    else ids.add(r.id);

    if (!SEVERITIES.has(r.severity)) p(`${where}.severity must be one of ${[...SEVERITIES].join("|")}`);
    if (typeof r.title !== "string" || !r.title) p(`${where}.title is required`);
    if (typeof r.description !== "string" || !r.description) p(`${where}.description is required`);

    if (typeof r.detect !== "object" || r.detect === null) p(`${where}.detect is required`);
    else {
      if (!Array.isArray(r.detect.patterns) || r.detect.patterns.length === 0) p(`${where}.detect.patterns must be a non-empty array`);
      else {
        r.detect.patterns.forEach((pat: unknown, j: number) => {
          if (typeof pat !== "string") p(`${where}.detect.patterns[${j}] must be a string`);
          else {
            try {
              new RegExp(pat);
            } catch (e) {
              p(`${where}.detect.patterns[${j}] is not a valid regex: ${(e as Error).message}`);
            }
          }
        });
      }
      if (!Array.isArray(r.detect.filePatterns) || r.detect.filePatterns.length === 0) p(`${where}.detect.filePatterns must be a non-empty array`);
    }

    if (typeof r.replace !== "object" || r.replace === null) p(`${where}.replace is required`);
    else if (typeof r.replace.guidance !== "string" || !r.replace.guidance) p(`${where}.replace.guidance is required`);
  });

  return problems;
}
