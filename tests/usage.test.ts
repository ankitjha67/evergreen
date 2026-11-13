// Tests for FR-10.5 — Usage tracking
import { describe, it, expect } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { logUsage, UsageRecord } from "../src/usage.js";

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
