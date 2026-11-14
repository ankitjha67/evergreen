// Export/import - export scan results, migration reports, or history as CSV/JSON
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ScanResult, Finding, MigrationOutcome } from "./types.js";
import { queryHistory, type HistoryEntry, type HistorySummary } from "./history.js";

export type ExportFormat = "json" | "csv";
export type ExportTarget = "scan" | "history" | "findings";

export interface ExportOptions {
  format: ExportFormat;
  target: ExportTarget;
  outPath?: string;
  repo?: string;
  specRef?: string;
  since?: string;
  limit?: number;
}

export interface ExportResult {
  format: ExportFormat;
  target: ExportTarget;
  records: number;
  output: string;
  savedTo?: string;
}

export async function exportData(options: ExportOptions): Promise<ExportResult> {
  switch (options.target) {
    case "history":
      return exportHistory(options);
    case "scan":
      return exportScan(options);
    case "findings":
      return exportFindings(options);
    default:
      throw new Error(`Unknown export target: ${options.target}`);
  }
}

async function exportHistory(options: ExportOptions): Promise<ExportResult> {
  const summary = await queryHistory({
    repo: options.repo,
    specRef: options.specRef,
    since: options.since,
    limit: options.limit ?? 1000,
  });

  const entries = summary.entries;

  let output: string;
  if (options.format === "csv") {
    output = historyToCsv(entries);
  } else {
    output = JSON.stringify({ exported: new Date().toISOString(), target: "history", records: entries.length, data: entries }, null, 2);
  }

  const result: ExportResult = { format: options.format, target: "history", records: entries.length, output };

  if (options.outPath) {
    await writeFile(resolve(options.outPath), output, "utf8");
    result.savedTo = resolve(options.outPath);
  }

  return result;
}

async function exportScan(options: ExportOptions): Promise<ExportResult> {
  const reportPath = join(resolve(options.repo ?? "."), ".evergreen", "MIGRATION_REPORT.md");
  let reportContent: string;
  try {
    reportContent = await readFile(reportPath, "utf8");
  } catch {
    throw new Error("No migration report found. Run `evergreen scan` or `evergreen migrate` first.");
  }

  let output: string;
  if (options.format === "csv") {
    output = `"type","content"\n"report","${escapeCsv(reportContent)}"`;
  } else {
    output = JSON.stringify({ exported: new Date().toISOString(), target: "scan", report: reportContent }, null, 2);
  }

  const result: ExportResult = { format: options.format, target: "scan", records: 1, output };

  if (options.outPath) {
    await writeFile(resolve(options.outPath), output, "utf8");
    result.savedTo = resolve(options.outPath);
  }

  return result;
}

async function exportFindings(options: ExportOptions): Promise<ExportResult> {
  const summary = await queryHistory({
    repo: options.repo,
    specRef: options.specRef,
    since: options.since,
    limit: options.limit ?? 1000,
  });

  const rows = summary.entries.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    repo: e.repo,
    specRef: e.specRef,
    status: e.status,
    findings: e.findings,
    filesChanged: e.filesChanged,
    confidence: e.confidence,
    costUSD: e.costUSD,
    durationMs: e.durationMs,
    provider: e.provider,
    model: e.model,
    prUrl: e.prUrl ?? "",
    verified: e.verifyResult ? (e.verifyResult.passed ? "passed" : "failed") : "",
  }));

  let output: string;
  if (options.format === "csv") {
    output = findingsToCsv(rows);
  } else {
    output = JSON.stringify({ exported: new Date().toISOString(), target: "findings", records: rows.length, data: rows }, null, 2);
  }

  const result: ExportResult = { format: options.format, target: "findings", records: rows.length, output };

  if (options.outPath) {
    await writeFile(resolve(options.outPath), output, "utf8");
    result.savedTo = resolve(options.outPath);
  }

  return result;
}

function historyToCsv(entries: HistoryEntry[]): string {
  const headers = ["id", "timestamp", "repo", "specRef", "status", "branch", "findings", "filesChanged", "confidence", "costUSD", "durationMs", "provider", "model", "prUrl", "verifyPassed"];
  const rows = entries.map((e) => [
    e.id,
    e.timestamp,
    e.repo,
    e.specRef,
    e.status,
    e.branch ?? "",
    String(e.findings),
    String(e.filesChanged),
    String(e.confidence),
    String(e.costUSD),
    String(e.durationMs),
    e.provider,
    e.model,
    e.prUrl ?? "",
    e.verifyResult !== undefined ? String(e.verifyResult.passed) : "",
  ]);

  return [headers.join(","), ...rows.map((r) => r.map((v) => `"${escapeCsv(v)}"`).join(","))].join("\n");
}

function findingsToCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const dataRows = rows.map((r) => headers.map((h) => `"${escapeCsv(String(r[h]))}"`).join(","));
  return [headers.join(","), ...dataRows].join("\n");
}

function escapeCsv(value: string): string {
  return value.replace(/"/g, '""').replace(/\n/g, "\\n").replace(/\r/g, "");
}

export function parseExportFormat(fmt: string): ExportFormat {
  const lower = fmt.toLowerCase();
  if (lower === "json" || lower === "csv") return lower;
  throw new Error(`Unsupported export format: ${fmt}. Use 'json' or 'csv'.`);
}

export function parseExportTarget(target: string): ExportTarget {
  const lower = target.toLowerCase();
  if (lower === "scan" || lower === "history" || lower === "findings") return lower;
  throw new Error(`Unknown export target: ${target}. Use 'scan', 'history', or 'findings'.`);
}
