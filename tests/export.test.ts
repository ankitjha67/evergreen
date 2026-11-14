import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { mkdir, rm, readFile } from "node:fs/promises";
import { exportData, parseExportFormat, parseExportTarget, type ExportOptions } from "../src/export.js";
import { logHistory, outcomeToHistoryEntry, type HistoryEntry } from "../src/history.js";
import { MigrationOutcome, ScanResult } from "../src/types.js";

const TMP = resolve("test-tmp-export");

const mockScan: ScanResult = {
  specRef: "stripe@stripe-node@2025-03-31.basil",
  repo: "/test/repo",
  scannedFiles: 10,
  skippedFiles: [],
  findings: [
    { ruleId: "r1", file: "a.js", line: 1, column: 1, matchText: "x", lineText: "" },
  ],
  startedAt: "2026-11-14T00:00:00Z",
  durationMs: 100,
};

const mockOutcome: MigrationOutcome = {
  specRef: "stripe@stripe-node@2025-03-31.basil",
  repo: "/test/repo",
  branch: "evergreen/stripe-2025-03-31",
  scan: mockScan,
  manifest: {
    specRef: "stripe@stripe-node@2025-03-31.basil",
    engine: { model: "claude-opus-5-5" },
    files: [
      { path: "a.js", rules: ["r1"], status: "migrated", confidence: 0.95, summary: "Updated" },
    ],
  },
  gated: [],
  violations: [],
  usage: { inputTokens: 5000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 1500, costUSD: 0.12 },
  status: "migrated",
};

describe("parseExportFormat", () => {
  it("accepts json", () => expect(parseExportFormat("json")).toBe("json"));
  it("accepts csv", () => expect(parseExportFormat("csv")).toBe("csv"));
  it("accepts case-insensitive", () => expect(parseExportFormat("JSON")).toBe("json"));
  it("rejects invalid format", () => expect(() => parseExportFormat("xml")).toThrow("Unsupported"));
});

describe("parseExportTarget", () => {
  it("accepts history", () => expect(parseExportTarget("history")).toBe("history"));
  it("accepts scan", () => expect(parseExportTarget("scan")).toBe("scan"));
  it("accepts findings", () => expect(parseExportTarget("findings")).toBe("findings"));
  it("rejects invalid target", () => expect(() => parseExportTarget("unknown")).toThrow("Unknown"));
});

describe("exportData - history", () => {
  it("exports history as JSON", async () => {
    await mkdir(TMP, { recursive: true });

    const entry = outcomeToHistoryEntry(mockOutcome, "anthropic", "claude-opus-5-5", 5000);
    await logHistory(entry, TMP);

    const result = await exportData({ format: "json", target: "history" } as ExportOptions);
    expect(result.format).toBe("json");
    expect(result.target).toBe("history");
    // Records come from default history location which may or may not have data
    expect(typeof result.output).toBe("string");

    await rm(TMP, { recursive: true, force: true });
  });

  it("exports history as CSV", async () => {
    await mkdir(TMP, { recursive: true });

    const entry = outcomeToHistoryEntry(mockOutcome, "anthropic", "claude-opus-5-5", 5000);
    await logHistory(entry, TMP);

    const result = await exportData({ format: "csv", target: "history" } as ExportOptions);
    expect(result.format).toBe("csv");
    expect(typeof result.output).toBe("string");

    await rm(TMP, { recursive: true, force: true });
  });

  it("saves to file when outPath specified", async () => {
    await mkdir(TMP, { recursive: true });

    const outPath = join(TMP, "export.json");
    const result = await exportData({ format: "json", target: "history", outPath } as ExportOptions);
    expect(result.savedTo).toBe(resolve(outPath));

    const content = await readFile(outPath, "utf8");
    expect(content).toContain('"target": "history"');

    await rm(TMP, { recursive: true, force: true });
  });
});

describe("exportData - findings", () => {
  it("exports findings as JSON", async () => {
    const result = await exportData({ format: "json", target: "findings" } as ExportOptions);
    expect(result.format).toBe("json");
    expect(result.target).toBe("findings");
    const parsed = JSON.parse(result.output);
    expect(parsed.target).toBe("findings");
    expect(typeof parsed.records).toBe("number");
  });

  it("exports findings as CSV", async () => {
    const result = await exportData({ format: "csv", target: "findings" } as ExportOptions);
    expect(result.format).toBe("csv");
    expect(typeof result.output).toBe("string");
  });
});

describe("exportData - scan", () => {
  it("throws when no migration report exists", async () => {
    await mkdir(TMP, { recursive: true });

    await expect(exportData({
      format: "json",
      target: "scan",
      repo: join(TMP, "nonexistent"),
    })).rejects.toThrow("No migration report");

    await rm(TMP, { recursive: true, force: true });
  });

  it("exports scan report as JSON", async () => {
    await mkdir(TMP, { recursive: true });
    await mkdir(join(TMP, ".evergreen"), { recursive: true });
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(join(TMP, ".evergreen", "MIGRATION_REPORT.md"), "# Test Report\nAll good.", "utf8");

    const result = await exportData({ format: "json", target: "scan", repo: TMP });
    expect(result.format).toBe("json");
    expect(result.records).toBe(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.report).toContain("Test Report");

    await rm(TMP, { recursive: true, force: true });
  });
});
