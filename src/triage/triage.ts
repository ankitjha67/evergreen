// FR-03.2 — Triage pass: Claude Haiku 5.5 discards false positives before migration.
// Conservative by contract: uncertain => affected; any failure => all findings treated affected.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BreakingChangeSpec, Finding, TokenUsage } from "../types.js";
import { DEFAULTS } from "../config.js";
import { runAgentSession } from "../migrator/agent.js";

export type Verdict = "affected" | "not_affected" | "uncertain";

export interface TriagedFinding extends Finding {
  verdict: Verdict;
  reason: string;
}

export interface TriageResult {
  findings: TriagedFinding[];
  usage?: TokenUsage;
  degraded?: string; // set when triage failed and everything was kept conservatively
}

const CONTEXT_LINES = 10;

export async function triage(repo: string, spec: BreakingChangeSpec, findings: Finding[]): Promise<TriageResult> {
  if (findings.length === 0) return { findings: [] };

  const keepAll = (why: string): TriageResult => ({
    findings: findings.map((f) => ({ ...f, verdict: "affected" as Verdict, reason: `triage degraded: ${why}` })),
    degraded: why,
  });

  let prompt: string;
  try {
    prompt = await buildTriagePrompt(repo, spec, findings);
  } catch (e) {
    return keepAll(`context assembly failed (${(e as Error).message})`);
  }

  try {
    const { usage, finalText } = await runAgentSession(repo, prompt, {
      model: DEFAULTS.triageModel,
      maxTurns: 1,
      allowedTools: [],
    });
    const verdicts = parseVerdicts(finalText, findings.length);
    if (!verdicts) return { ...keepAll("unparseable triage response"), usage };
    return {
      findings: findings.map((f, i) => ({
        ...f,
        verdict: verdicts[i].verdict,
        reason: verdicts[i].reason,
      })),
      usage,
    };
  } catch (e) {
    return keepAll(`triage call failed (${(e as Error).message})`);
  }
}

/** Findings that migration should act on: affected + uncertain (FR-03.2 conservative rule). */
export function actionable(triaged: TriagedFinding[]): Finding[] {
  return triaged
    .filter((t) => t.verdict !== "not_affected")
    .map(({ verdict: _v, reason: _r, ...finding }) => finding);
}

async function buildTriagePrompt(repo: string, spec: BreakingChangeSpec, findings: Finding[]): Promise<string> {
  const fileCache = new Map<string, string[]>();
  const contextFor = async (f: Finding): Promise<string> => {
    if (!fileCache.has(f.file)) {
      fileCache.set(f.file, (await readFile(join(repo, f.file), "utf8")).split(/\r?\n/));
    }
    const lines = fileCache.get(f.file)!;
    const start = Math.max(0, f.line - 1 - CONTEXT_LINES);
    const end = Math.min(lines.length, f.line + CONTEXT_LINES);
    return lines
      .slice(start, end)
      .map((l, idx) => `${start + idx + 1 === f.line ? ">>" : "  "} ${start + idx + 1}: ${l}`)
      .join("\n");
  };

  const ruleSummaries = spec.changes
    .filter((c) => findings.some((f) => f.ruleId === c.id))
    .map((c) => `- ${c.id}: ${c.title}. ${c.description}${c.detect.notes ? ` Triage notes: ${c.detect.notes}` : ""}`)
    .join("\n");

  const candidates: string[] = [];
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    candidates.push(`### Candidate ${i}\nFile: ${f.file} line ${f.line} | Rule: ${f.ruleId} | Matched: ${f.matchText}\n\`\`\`\n${await contextFor(f)}\n\`\`\``);
  }

  return `You are a code triage classifier for an API migration (${spec.vendor} ${spec.version}). A regex scanner produced candidate locations; decide for each whether it is genuinely affected by the breaking change or a false positive (e.g., the NEW pattern already in use, a comment/string mention, an unrelated object with a same-named property).

Rules under consideration:
${ruleSummaries}

${candidates.join("\n\n")}

Reply with ONLY a JSON array, one entry per candidate, in order:
[{"i": 0, "verdict": "affected" | "not_affected" | "uncertain", "reason": "<one short sentence>"}, ...]
When in doubt, use "uncertain" — never "not_affected" unless you are sure.`;
}

export function parseVerdicts(text: string, expected: number): { verdict: Verdict; reason: string }[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== expected) return null;
  const out: { verdict: Verdict; reason: string }[] = [];
  const byIndex = new Map<number, any>();
  for (const e of arr) {
    if (typeof e !== "object" || e === null || typeof (e as any).i !== "number") return null;
    byIndex.set((e as any).i, e);
  }
  for (let i = 0; i < expected; i++) {
    const e = byIndex.get(i);
    if (!e || !["affected", "not_affected", "uncertain"].includes(e.verdict)) return null;
    out.push({ verdict: e.verdict as Verdict, reason: typeof e.reason === "string" ? e.reason : "" });
  }
  return out;
}
