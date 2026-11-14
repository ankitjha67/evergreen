import { describe, it, expect, vi, beforeEach } from "vitest";
import { compareCosts, formatCostComparison, type CostComparison } from "../src/cost-compare.js";
import type { Finding } from "../src/types.js";

vi.mock("../src/estimate.js", () => ({
  estimateMigrationCost: vi.fn(async (_repo: string, findings: any[], model: string, provider: string) => ({
    model,
    provider,
    findings: findings.length,
    affectedFiles: 1,
    estimatedInputTokens: model.includes("haiku") ? 1000 : model.includes("mini") ? 1200 : 2000,
    estimatedOutputTokens: model.includes("haiku") ? 500 : model.includes("mini") ? 600 : 1000,
    estimatedCostUSD: model.includes("haiku") ? 0.001 : model.includes("mini") ? 0.002 : 0.05,
    breakdown: { promptBaseTokens: 500, contextTokens: 500, outputTokens: 500 },
    pricing: null,
    confidence: "medium" as const,
  })),
}));

const mockFindings: Finding[] = [
  {
    ruleId: "test-001",
    severity: "breaking",
    file: "src/index.ts",
    line: 10,
    matchedPattern: "oldApi()",
    title: "Old API usage",
    guidance: "Update to new API",
  },
];

describe("compareCosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("compares costs across default models", async () => {
    const result = await compareCosts("/repo", mockFindings);
    expect(result.models.length).toBeGreaterThan(0);
    expect(result.cheapest.costUSD).toBeLessThanOrEqual(result.mostExpensive.costUSD);
    expect(result.findings).toBe(1);
  });

  it("compares costs for specific models", async () => {
    const result = await compareCosts("/repo", mockFindings, [
      "claude-haiku-5-5",
      "claude-opus-5-5",
    ]);
    expect(result.models).toHaveLength(2);
    expect(result.cheapest.model).toBe("claude-haiku-5-5");
    expect(result.mostExpensive.model).toBe("claude-opus-5-5");
  });

  it("handles empty findings", async () => {
    const result = await compareCosts("/repo", []);
    expect(result.findings).toBe(0);
  });

  it("sorts models by cost ascending", async () => {
    const result = await compareCosts("/repo", mockFindings, [
      "claude-opus-5-5",
      "claude-haiku-5-5",
    ]);
    for (let i = 1; i < result.models.length; i++) {
      expect(result.models[i].estimatedCostUSD).toBeGreaterThanOrEqual(
        result.models[i - 1].estimatedCostUSD,
      );
    }
  });
});

describe("formatCostComparison", () => {
  it("shows 'no models' for empty comparison", () => {
    const empty: CostComparison = {
      models: [],
      cheapest: { model: "none", costUSD: 0 },
      mostExpensive: { model: "none", costUSD: 0 },
      findings: 0,
      affectedFiles: 0,
    };
    const formatted = formatCostComparison(empty);
    expect(formatted).toContain("No models");
  });

  it("formats comparison table", async () => {
    const result = await compareCosts("/repo", mockFindings, [
      "claude-haiku-5-5",
      "claude-opus-5-5",
    ]);
    const formatted = formatCostComparison(result);
    expect(formatted).toContain("Cost Comparison");
    expect(formatted).toContain("claude-haiku-5-5");
    expect(formatted).toContain("claude-opus-5-5");
    expect(formatted).toContain("Cheapest");
    expect(formatted).toContain("Most expensive");
  });

  it("shows price range ratio", async () => {
    const result = await compareCosts("/repo", mockFindings, [
      "claude-haiku-5-5",
      "claude-opus-5-5",
    ]);
    const formatted = formatCostComparison(result);
    expect(formatted).toContain("difference");
  });
});
