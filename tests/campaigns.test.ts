import { describe, it, expect } from "vitest";
import { buildCampaignStats, CampaignStats } from "../src/server/campaigns.js";
import type { UsageRecord } from "../src/usage.js";

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    timestamp: "2026-01-15T10:00:00Z",
    event: "scan" as const,
    repo: "acme/web",
    specRef: "stripe@stripe-node@2025-03-31.basil",
    provider: "anthropic",
    model: "claude-opus-5-5",
    usage: { inputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 500, costUSD: 0.03 },
    findings: 3,
    filesChanged: 0,
    durationMs: 1200,
    ...overrides,
  };
}

describe("buildCampaignStats", () => {
  it("returns empty array for no records", () => {
    expect(buildCampaignStats([])).toEqual([]);
  });

  it("groups records by specRef", () => {
    const records = [
      makeRecord({ specRef: "stripe@stripe-node@v1" }),
      makeRecord({ specRef: "stripe@stripe-python@v2" }),
      makeRecord({ specRef: "stripe@stripe-node@v1" }),
    ];
    const stats = buildCampaignStats(records);
    expect(stats).toHaveLength(2);
    const nodeStats = stats.find((s) => s.specRef === "stripe@stripe-node@v1");
    expect(nodeStats).toBeDefined();
  });

  it("counts repos and findings correctly", () => {
    const records = [
      makeRecord({ repo: "acme/web", findings: 5 }),
      makeRecord({ repo: "acme/api", findings: 3 }),
      makeRecord({ repo: "acme/web", findings: 2 }),
    ];
    const stats = buildCampaignStats(records);
    expect(stats).toHaveLength(1);
    expect(stats[0].reposScanned).toBe(2);
    expect(stats[0].reposAffected).toBe(2);
    expect(stats[0].totalFindings).toBe(10);
  });

  it("tracks PRs created", () => {
    const records = [
      makeRecord({ repo: "acme/web", prUrl: "https://github.com/acme/web/pull/1" }),
      makeRecord({ repo: "acme/api" }),
    ];
    const stats = buildCampaignStats(records);
    expect(stats[0].prsCreated).toBe(1);
  });

  it("aggregates costs and tokens", () => {
    const records = [
      makeRecord({ usage: { inputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 500, costUSD: 0.05 } }),
      makeRecord({ usage: { inputTokens: 2000, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 1000, costUSD: 0.10 } }),
    ];
    const stats = buildCampaignStats(records);
    expect(stats[0].totalCostUSD).toBe(0.15);
    expect(stats[0].totalTokens.input).toBe(3000);
    expect(stats[0].totalTokens.output).toBe(1500);
  });

  it("tracks first and last seen timestamps", () => {
    const records = [
      makeRecord({ timestamp: "2026-01-10T00:00:00Z" }),
      makeRecord({ timestamp: "2026-01-20T00:00:00Z" }),
      makeRecord({ timestamp: "2026-01-15T00:00:00Z" }),
    ];
    const stats = buildCampaignStats(records);
    expect(stats[0].firstSeen).toBe("2026-01-10T00:00:00Z");
    expect(stats[0].lastSeen).toBe("2026-01-20T00:00:00Z");
  });

  it("skips records without specRef", () => {
    const records = [
      makeRecord({ specRef: undefined as any }),
      makeRecord({ specRef: "stripe@stripe-node@v1" }),
    ];
    const stats = buildCampaignStats(records);
    expect(stats).toHaveLength(1);
  });

  it("parses vendor/api/version from specRef", () => {
    const records = [makeRecord({ specRef: "stripe@stripe-node@2025-03-31.basil" })];
    const stats = buildCampaignStats(records);
    expect(stats[0].vendor).toBe("stripe");
    expect(stats[0].api).toBe("stripe-node");
    expect(stats[0].version).toBe("2025-03-31.basil");
  });
});
