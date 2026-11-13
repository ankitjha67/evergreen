// FR-10.5 — Usage tracking: append usage records to data/usage.jsonl
import { appendFile, mkdir } from "node:fs/promises";
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
    // Non-critical — don't fail the operation
  }
}
