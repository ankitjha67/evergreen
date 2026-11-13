// Tests for FR-10.5 — Usage tracking
import { describe, it, expect } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { logUsage, getUsageSummary, UsageRecord } from "../src/usage.js";

describe("logUsage", () => {
  it("creates data/usage.jsonl and appends a record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evergreen-usage-test-"));
    const record: UsageRecord = {
      timestamp: "2026-11-13T00:00:00.000Z",
      event: "scan",
      repo: "owner/repo",
      specRef: "stripe@2025-03-31",
      provider: "anthropic",
      model: "claude-opus-5-5",
      usage: { inputTokens: 100, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 50, costUSD: 0.0014 },
      findings: 3,
    };

    await logUsage(record, dir);
    const content = await readFile(join(dir, "data", "usage.jsonl"), "utf8");
    const parsed = JSON.parse(content.trim());
    expect(parsed.event).toBe("scan");
    expect(parsed.repo).toBe("owner/repo");
    expect(parsed.usage.inputTokens).toBe(100);

    await rm(dir, { recursive: true, force: true });
  });

  it("appends multiple records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evergreen-usage-test-"));
    const base: UsageRecord = {
      timestamp: "2026-11-13T00:00:00.000Z",
      event: "migrate",
      repo: "owner/repo",
      specRef: "stripe@2025-03-31",
      provider: "openai",
      model: "gpt-4o",
      usage: { inputTokens: 200, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 100, costUSD: 0.005 },
    };

    await logUsage(base, dir);
    await logUsage({ ...base, event: "auto-pr", prUrl: "https://github.com/a/b/pull/1" }, dir);

    const content = await readFile(join(dir, "data", "usage.jsonl"), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe("migrate");
    expect(JSON.parse(lines[1]).event).toBe("auto-pr");

    await rm(dir, { recursive: true, force: true });
  });
});

describe("getUsageSummary", () => {
  it("returns empty summary when no usage file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evergreen-usage-test-"));
    const summary = await getUsageSummary(dir);
    expect(summary.totalEvents).toBe(0);
    expect(summary.totalCostUSD).toBe(0);
    expect(summary.recentEvents).toHaveLength(0);
    await rm(dir, { recursive: true, force: true });
  });

  it("aggregates usage records correctly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evergreen-usage-test-"));
    const base: UsageRecord = {
      timestamp: "2026-11-13T00:00:00.000Z",
      event: "migrate",
      repo: "owner/repo",
      specRef: "stripe@2025-03-31",
      provider: "anthropic",
      model: "claude-opus-5-5",
      usage: { inputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 500, costUSD: 0.10 },
      findings: 5,
      filesChanged: 3,
    };

    await logUsage(base, dir);
    await logUsage({ ...base, event: "auto-pr", provider: "openai", model: "gpt-4o", prUrl: "https://github.com/a/b/pull/1" }, dir);
    await logUsage({ ...base, event: "scan", repo: "other/repo" }, dir);

    const summary = await getUsageSummary(dir);
    expect(summary.totalEvents).toBe(3);
    expect(summary.byEvent.migrate).toBe(1);
    expect(summary.byEvent["auto-pr"]).toBe(1);
    expect(summary.byEvent.scan).toBe(1);
    expect(summary.byProvider.anthropic).toBe(2);
    expect(summary.byProvider.openai).toBe(1);
    expect(summary.byRepo["owner/repo"]).toBe(2);
    expect(summary.byRepo["other/repo"]).toBe(1);
    expect(summary.totalCostUSD).toBe(0.3);
    expect(summary.totalTokens.input).toBe(3000);
    expect(summary.totalTokens.output).toBe(1500);
    expect(summary.prsCreated).toBe(1);
    expect(summary.recentEvents).toHaveLength(3);
    expect(summary.recentEvents[0].event).toBe("scan"); // most recent first

    await rm(dir, { recursive: true, force: true });
  });
});
