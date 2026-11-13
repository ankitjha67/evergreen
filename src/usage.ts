// FR-10.5 - Usage tracking: append usage records to data/usage.jsonl
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { TokenUsage } from "./types.js";

export interface UsageRecord {
  timestamp: string;
  event: "scan" | "triage" | "migrate" | "auto-pr";
  repo: string;
  specRef: string;
  provider: string;
  model: string;
  usage: TokenUsage;
  findings?: number;
  filesChanged?: number;
  prUrl?: string;
  durationMs?: number;
}

const USAGE_FILE = join("data", "usage.jsonl");

export async function logUsage(record: UsageRecord, baseDir?: string): Promise<void> {
  const filePath = baseDir ? join(baseDir, USAGE_FILE) : USAGE_FILE;
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
  } catch {
    // Non-critical - don't fail the operation
  }
}

export interface UsageSummary {
  totalEvents: number;
  byEvent: Record<string, number>;
  byProvider: Record<string, number>;
  byRepo: Record<string, number>;
  totalCostUSD: number;
  totalTokens: { input: number; output: number };
  prsCreated: number;
  recentEvents: UsageRecord[];
}

export async function getUsageSummary(baseDir?: string, limit = 50): Promise<UsageSummary> {
  const filePath = baseDir ? join(baseDir, USAGE_FILE) : USAGE_FILE;
  const summary: UsageSummary = {
    totalEvents: 0,
    byEvent: {},
    byProvider: {},
    byRepo: {},
    totalCostUSD: 0,
    totalTokens: { input: 0, output: 0 },
    prsCreated: 0,
    recentEvents: [],
  };

  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return summary;
  }

  const lines = content.trim().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as UsageRecord;
      summary.totalEvents++;
      summary.byEvent[record.event] = (summary.byEvent[record.event] ?? 0) + 1;
      summary.byProvider[record.provider] = (summary.byProvider[record.provider] ?? 0) + 1;
      summary.byRepo[record.repo] = (summary.byRepo[record.repo] ?? 0) + 1;
      summary.totalCostUSD += record.usage.costUSD;
      summary.totalTokens.input += record.usage.inputTokens;
      summary.totalTokens.output += record.usage.outputTokens;
      if (record.prUrl) summary.prsCreated++;
    } catch { /* skip malformed lines */ }
  }

  summary.totalCostUSD = Number(summary.totalCostUSD.toFixed(4));
  summary.recentEvents = lines
    .slice(-limit)
    .reverse()
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  return summary;
}
