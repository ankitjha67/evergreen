import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import {
  outcomeToHistoryEntry,
  logHistory,
  queryHistory,
  formatHistoryEntry,
  formatHistorySummary,
  type HistoryEntry,
} from "../src/history.js";
import { MigrationOutcome, ScanResult } from "../src/types.js";

const TMP = resolve("test-tmp-history");

const mockScan: ScanResult = {
  specRef: "stripe@stripe-node@2025-03-31.basil",
  repo: "/test/repo",
  scannedFiles: 10,
  skippedFiles: [],
  findings: [
    { ruleId: "r1", file: "a.js", line: 1, column: 1, matchText: "x", lineText: "" },
    { ruleId: "r1", file: "b.js", line: 2, column: 1, matchText: "y", lineText: "" },
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
      { path: "b.js", rules: ["r1"], status: "migrated", confidence: 0.88, summary: "Updated" },
    ],
  },
  gated: [],
  violations: [],
  usage: { inputTokens: 5000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 1500, costUSD: 0.12 },
  status: "migrated",
};

describe("outcomeToHistoryEntry", () => {
  it("converts MigrationOutcome to HistoryEntry", () => {
    const entry = outcomeToHistoryEntry(mockOutcome, "anthropic", "claude-opus-5-5", 5000);
    expect(entry.id).toMatch(/^mig-/);
    expect(entry.repo).toBe("/test/repo");
    expect(entry.specRef).toBe("stripe@stripe-node@2025-03-31.basil");
    expect(entry.status).toBe("migrated");
    expect(entry.filesChanged).toBe(2);
    expect(entry.confidence).toBe(0.92); // avg of 0.95, 0.88 -> 0.915 -> 0.92
    expect(entry.costUSD).toBe(0.12);
    expect(entry.provider).toBe("anthropic");
    expect(entry.model).toBe("claude-opus-5-5");
  });

  it("includes PR URL when provided", () => {
    const entry = outcomeToHistoryEntry(mockOutcome, "anthropic", "claude-opus-5-5", 3000, "https://github.com/pr/1");
    expect(entry.prUrl).toBe("https://github.com/pr/1");
  });

  it("handles outcome with verify result", () => {
    const withVerify: MigrationOutcome = {
      ...mockOutcome,
      verify: { command: "npm test", exitCode: 0, tail: "All tests passed" },
    };
    const entry = outcomeToHistoryEntry(withVerify, "anthropic", "claude-opus-5-5", 8000);
    expect(entry.verifyResult).toBeDefined();
    expect(entry.verifyResult!.passed).toBe(true);
    expect(entry.verifyResult!.exitCode).toBe(0);
  });
});

describe("logHistory + queryHistory", () => {
  it("logs and queries history entries", async () => {
    await mkdir(TMP, { recursive: true });

    const entry1 = outcomeToHistoryEntry(mockOutcome, "anthropic", "claude-opus-5-5", 5000);
    await logHistory(entry1, TMP);

    const entry2 = outcomeToHistoryEntry(
      { ...mockOutcome, repo: "/other/repo", status: "failed" },
      "openai", "gpt-4o", 3000,
    );
    await logHistory(entry2, TMP);

    // Query all
    const all = await queryHistory({}, TMP);
    expect(all.totalRuns).toBe(2);
    expect(all.byStatus.migrated).toBe(1);
    expect(all.byStatus.failed).toBe(1);
    expect(all.totalCostUSD).toBe(0.24);

    // Query by repo
    const byRepo = await queryHistory({ repo: "/other/repo" }, TMP);
    expect(byRepo.totalRuns).toBe(1);
    expect(byRepo.entries[0].repo).toBe("/other/repo");

    // Query by status
    const byStatus = await queryHistory({ status: "migrated" }, TMP);
    expect(byStatus.totalRuns).toBe(1);

    // Success rate
    expect(all.successRate).toBe(0.5);
    expect(all.avgConfidence).toBeGreaterThan(0);

    await rm(TMP, { recursive: true, force: true });
  });

  it("returns empty summary when no history file", async () => {
    const summary = await queryHistory({}, join(TMP, "nonexistent"));
    expect(summary.totalRuns).toBe(0);
    expect(summary.entries).toHaveLength(0);
  });
});

describe("formatHistoryEntry", () => {
  it("formats a successful migration entry", () => {
    const entry: HistoryEntry = {
      id: "mig-test",
      timestamp: "2026-11-14T10:00:00Z",
      repo: "/test/repo",
      specRef: "stripe@stripe-node@2025-03-31.basil",
      status: "migrated",
      branch: "evergreen/stripe-2025-03-31",
      findings: 3,
      filesChanged: 2,
      confidence: 0.92,
      costUSD: 0.12,
      durationMs: 5000,
      provider: "anthropic",
      model: "claude-opus-5-5",
    };
    const formatted = formatHistoryEntry(entry);
    expect(formatted).toContain("[OK]");
    expect(formatted).toContain("2 files");
    expect(formatted).toContain("0.92");
    expect(formatted).toContain("$0.12");
    expect(formatted).toContain("5.0s");
  });

  it("formats a failed entry with verify failure", () => {
    const entry: HistoryEntry = {
      id: "mig-test",
      timestamp: "2026-11-14T10:00:00Z",
      repo: "/test/repo",
      specRef: "test@test@1",
      status: "failed",
      findings: 1,
      filesChanged: 0,
      confidence: 0,
      costUSD: 0.05,
      durationMs: 2000,
      provider: "openai",
      model: "gpt-4o",
      verifyResult: { exitCode: 1, passed: false },
    };
    const formatted = formatHistoryEntry(entry);
    expect(formatted).toContain("[FAILED]");
    expect(formatted).toContain("[verify FAILED]");
  });
});

describe("formatHistorySummary", () => {
  it("shows 'no history' for empty summary", () => {
    const formatted = formatHistorySummary({
      totalRuns: 0, entries: [], byStatus: {}, byRepo: {}, bySpec: {},
      totalCostUSD: 0, avgConfidence: 0, avgDurationMs: 0, successRate: 0,
    });
    expect(formatted).toContain("No migration history found");
  });

  it("formats non-empty summary", () => {
    const formatted = formatHistorySummary({
      totalRuns: 5,
      entries: [],
      byStatus: { migrated: 4, failed: 1 },
      byRepo: { "repo-a": 3, "repo-b": 2 },
      bySpec: { "test@test@1": 5 },
      totalCostUSD: 1.5,
      avgConfidence: 0.89,
      avgDurationMs: 4000,
      successRate: 0.8,
    });
    expect(formatted).toContain("5 run(s)");
    expect(formatted).toContain("80%");
    expect(formatted).toContain("$1.5");
  });
});
