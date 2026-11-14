// Migration history tracking - persistent log of migration runs
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { MigrationOutcome } from "./types.js";

export interface HistoryEntry {
  id: string;
  timestamp: string;
  repo: string;
  specRef: string;
  status: MigrationOutcome["status"];
  branch?: string;
  findings: number;
  filesChanged: number;
  confidence: number;
  costUSD: number;
  durationMs: number;
  provider: string;
  model: string;
  prUrl?: string;
  verifyResult?: { exitCode: number; passed: boolean };
}

const HISTORY_FILE = join("data", "history.jsonl");

function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `mig-${ts}-${rand}`;
}

export function outcomeToHistoryEntry(
  outcome: MigrationOutcome,
  provider: string,
  model: string,
  durationMs: number,
  prUrl?: string,
): HistoryEntry {
  const filesChanged = outcome.manifest?.files.filter((f) => f.status === "migrated").length ?? 0;
  const avgConfidence = outcome.manifest?.files.length
    ? outcome.manifest.files.reduce((sum, f) => sum + f.confidence, 0) / outcome.manifest.files.length
    : 0;

  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    repo: outcome.repo,
    specRef: outcome.specRef,
    status: outcome.status,
    branch: outcome.branch,
    findings: outcome.scan.findings.length,
    filesChanged,
    confidence: Number(avgConfidence.toFixed(2)),
    costUSD: outcome.usage?.costUSD ?? 0,
    durationMs,
    provider,
    model,
    prUrl,
    verifyResult: outcome.verify
      ? { exitCode: outcome.verify.exitCode, passed: outcome.verify.exitCode === 0 }
      : undefined,
  };
}

export async function logHistory(entry: HistoryEntry, baseDir?: string): Promise<void> {
  const filePath = baseDir ? join(baseDir, HISTORY_FILE) : HISTORY_FILE;
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Non-critical
  }
}

export interface HistoryQuery {
  repo?: string;
  specRef?: string;
  status?: string;
  since?: string;
  limit?: number;
}

export interface HistorySummary {
  totalRuns: number;
  entries: HistoryEntry[];
  byStatus: Record<string, number>;
  byRepo: Record<string, number>;
  bySpec: Record<string, number>;
  totalCostUSD: number;
  avgConfidence: number;
  avgDurationMs: number;
  successRate: number;
}

export async function queryHistory(query?: HistoryQuery, baseDir?: string): Promise<HistorySummary> {
  const filePath = baseDir ? join(baseDir, HISTORY_FILE) : HISTORY_FILE;
  const summary: HistorySummary = {
    totalRuns: 0,
    entries: [],
    byStatus: {},
    byRepo: {},
    bySpec: {},
    totalCostUSD: 0,
    avgConfidence: 0,
    avgDurationMs: 0,
    successRate: 0,
  };

  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return summary;
  }

  const lines = content.trim().split("\n").filter(Boolean);
  let entries: HistoryEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as HistoryEntry);
    } catch { /* skip malformed */ }
  }

  if (query?.repo) {
    entries = entries.filter((e) => e.repo === query.repo || e.repo.includes(query.repo!));
  }
  if (query?.specRef) {
    entries = entries.filter((e) => e.specRef === query.specRef || e.specRef.includes(query.specRef!));
  }
  if (query?.status) {
    entries = entries.filter((e) => e.status === query.status);
  }
  if (query?.since) {
    const sinceDate = new Date(query.since);
    entries = entries.filter((e) => new Date(e.timestamp) >= sinceDate);
  }

  summary.totalRuns = entries.length;

  let totalConf = 0;
  let totalDur = 0;
  let migrated = 0;

  for (const entry of entries) {
    summary.byStatus[entry.status] = (summary.byStatus[entry.status] ?? 0) + 1;
    summary.byRepo[entry.repo] = (summary.byRepo[entry.repo] ?? 0) + 1;
    summary.bySpec[entry.specRef] = (summary.bySpec[entry.specRef] ?? 0) + 1;
    summary.totalCostUSD += entry.costUSD;
    totalConf += entry.confidence;
    totalDur += entry.durationMs;
    if (entry.status === "migrated") migrated++;
  }

  summary.totalCostUSD = Number(summary.totalCostUSD.toFixed(4));
  summary.avgConfidence = entries.length > 0 ? Number((totalConf / entries.length).toFixed(2)) : 0;
  summary.avgDurationMs = entries.length > 0 ? Math.round(totalDur / entries.length) : 0;
  summary.successRate = entries.length > 0 ? Number((migrated / entries.length).toFixed(2)) : 0;

  const limit = query?.limit ?? 50;
  summary.entries = entries.slice(-limit).reverse();

  return summary;
}

export function formatHistoryEntry(entry: HistoryEntry): string {
  const status = entry.status === "migrated" ? "OK" : entry.status.toUpperCase();
  const verify = entry.verifyResult ? (entry.verifyResult.passed ? " [verified]" : " [verify FAILED]") : "";
  const pr = entry.prUrl ? ` -> ${entry.prUrl}` : "";
  const cost = entry.costUSD > 0 ? ` $${entry.costUSD.toFixed(4)}` : "";
  const dur = entry.durationMs > 0 ? ` ${(entry.durationMs / 1000).toFixed(1)}s` : "";

  return `[${status}] ${entry.timestamp.slice(0, 19)} ${entry.repo} ${entry.specRef} (${entry.filesChanged} files, conf ${entry.confidence}${cost}${dur}${verify}${pr})`;
}

export function formatHistorySummary(summary: HistorySummary): string {
  if (summary.totalRuns === 0) return "No migration history found.";

  const lines: string[] = [
    `Migration History: ${summary.totalRuns} run(s)`,
    `  Success rate: ${(summary.successRate * 100).toFixed(0)}%`,
    `  Avg confidence: ${summary.avgConfidence}`,
    `  Total cost: $${summary.totalCostUSD.toFixed(4)}`,
    `  Avg duration: ${(summary.avgDurationMs / 1000).toFixed(1)}s`,
    "",
    "By status:",
    ...Object.entries(summary.byStatus).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Recent runs:",
    ...summary.entries.slice(0, 10).map((e) => "  " + formatHistoryEntry(e)),
  ];

  return lines.join("\n");
}
