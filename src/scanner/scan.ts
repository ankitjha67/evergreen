// FR-03.1 - Impact Scanner: deterministic pattern pass (FSD.md FR-03.1, SYSTEM_DESIGN.md §7)
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import fg from "fast-glob";
import { BreakingChangeSpec, Finding, ScanResult, RepoConfig, specRef } from "../types.js";
import { DEFAULTS } from "../config.js";

interface CompiledRule {
  ruleId: string;
  regexes: RegExp[];
  filePatterns: string[];
}

export async function scan(repo: string, spec: BreakingChangeSpec, cfg: RepoConfig = {}): Promise<ScanResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const rules: CompiledRule[] = spec.changes.map((c) => ({
    ruleId: c.id,
    regexes: c.detect.patterns.map((p) => new RegExp(p)), // validated at load (FR-01.2)
    filePatterns: c.detect.filePatterns,
  }));

  const ignore = [...DEFAULTS.excludes, ...(cfg.ignore ?? [])];
  const allPatterns = [...new Set(rules.flatMap((r) => r.filePatterns))];

  // Monorepo scoping: if scope paths are set, prefix all patterns with each scope
  const scopedPatterns = cfg.scope && cfg.scope.length > 0
    ? cfg.scope.flatMap((s) => allPatterns.map((p) => `${s.replace(/\/$/, "")}/${p}`))
    : allPatterns;
  const files = await fg(scopedPatterns, { cwd: repo, ignore, dot: false, onlyFiles: true });
  files.sort();

  const findings: Finding[] = [];
  const skippedFiles: string[] = [];
  let scannedFiles = 0;

  // per-file rule applicability (a rule only scans files matching its own filePatterns)
  const ruleFileSets = new Map<string, Set<string>>();
  for (const r of rules) {
    const ruleScopedPatterns = cfg.scope && cfg.scope.length > 0
      ? cfg.scope.flatMap((s) => r.filePatterns.map((p) => `${s.replace(/\/$/, "")}/${p}`))
      : r.filePatterns;
    const matched = await fg(ruleScopedPatterns, { cwd: repo, ignore, dot: false, onlyFiles: true });
    ruleFileSets.set(r.ruleId, new Set(matched));
  }

  for (const file of files) {
    const abs = join(repo, file);
    const st = await stat(abs);
    if (st.size > DEFAULTS.maxFileBytes) {
      skippedFiles.push(`${file} (too large)`);
      continue;
    }
    const buf = await readFile(abs);
    if (buf.subarray(0, 8192).includes(0)) {
      skippedFiles.push(`${file} (binary)`);
      continue;
    }
    scannedFiles++;
    const lines = buf.toString("utf8").split(/\r?\n/);
    for (const rule of rules) {
      if (!ruleFileSets.get(rule.ruleId)!.has(file)) continue;
      for (let i = 0; i < lines.length; i++) {
        for (const re of rule.regexes) {
          const m = lines[i].match(re);
          if (m && m.index !== undefined) {
            findings.push({
              ruleId: rule.ruleId,
              file,
              line: i + 1,
              column: m.index + 1,
              matchText: m[0],
              lineText: lines[i].trim().slice(0, 300),
            });
          }
        }
      }
    }
  }

  // dedupe: multiple patterns of one rule matching the same line count once
  const seen = new Set<string>();
  const deduped = findings.filter((f) => {
    const key = `${f.ruleId}:${f.file}:${f.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  findings.length = 0;
  findings.push(...deduped);

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.ruleId.localeCompare(b.ruleId));

  return {
    specRef: specRef(spec),
    repo,
    scannedFiles,
    skippedFiles,
    findings,
    startedAt,
    durationMs: Date.now() - t0,
  };
}

export function renderScanTable(result: ScanResult, spec: BreakingChangeSpec): string {
  if (result.findings.length === 0) {
    return `Not affected: 0 findings across ${result.scannedFiles} scanned files (${result.durationMs}ms).`;
  }
  const byRule = new Map<string, Finding[]>();
  for (const f of result.findings) {
    (byRule.get(f.ruleId) ?? byRule.set(f.ruleId, []).get(f.ruleId)!).push(f);
  }
  const lines: string[] = [];
  lines.push(`Spec: ${result.specRef} - ${result.findings.length} finding(s) in ${new Set(result.findings.map((f) => f.file)).size} file(s), ${result.scannedFiles} files scanned (${result.durationMs}ms)\n`);
  for (const [ruleId, fs] of byRule) {
    const rule = spec.changes.find((c) => c.id === ruleId);
    lines.push(`■ ${ruleId} - ${rule?.title ?? ""} [${rule?.severity}]`);
    for (const f of fs) lines.push(`    ${f.file}:${f.line}:${f.column}  ${f.lineText}`);
    lines.push("");
  }
  if (result.skippedFiles.length > 0) lines.push(`Skipped: ${result.skippedFiles.join(", ")}`);
  return lines.join("\n");
}
