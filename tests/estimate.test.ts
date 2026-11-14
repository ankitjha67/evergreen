import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { estimateMigrationCost, CostEstimate } from "../src/estimate.js";
import { Finding } from "../src/types.js";

const FIXTURE_REPO = resolve("fixtures/demo-repo");

function makeFinding(file: string, line: number): Finding {
  return {
    file,
    line,
    ruleId: "test-rule",
    matchText: "someOldApi()",
    severity: "breaking" as const,
  };
}

describe("estimateMigrationCost", () => {
  it("returns zero cost for empty findings", async () => {
    const est = await estimateMigrationCost(FIXTURE_REPO, [], "claude-opus-5-5", "anthropic");
    expect(est.findings).toBe(0);
    expect(est.affectedFiles).toBe(0);
    expect(est.estimatedCostUSD).toBeLessThan(0.05);
    expect(est.confidence).toBe("high");
  });

  it("estimates cost for findings against fixture files", async () => {
    const findings: Finding[] = [
      makeFinding("billing.js", 10),
      makeFinding("billing.js", 20),
      makeFinding("webhooks.js", 5),
    ];
    const est = await estimateMigrationCost(FIXTURE_REPO, findings, "claude-opus-5-5", "anthropic");

    expect(est.findings).toBe(3);
    expect(est.affectedFiles).toBe(2);
    expect(est.estimatedInputTokens).toBeGreaterThan(0);
    expect(est.estimatedOutputTokens).toBeGreaterThan(0);
    expect(est.estimatedCostUSD).toBeGreaterThan(0);
    expect(est.pricing).not.toBeNull();
    expect(est.confidence).toBe("high");
  });

  it("returns null pricing for unknown model", async () => {
    const findings: Finding[] = [makeFinding("billing.js", 10)];
    const est = await estimateMigrationCost(FIXTURE_REPO, findings, "unknown-model", "unknown");

    expect(est.estimatedCostUSD).toBe(0);
    expect(est.pricing).toBeNull();
  });

  it("uses fallback tokens for missing files", async () => {
    const findings: Finding[] = [makeFinding("nonexistent.js", 10)];
    const est = await estimateMigrationCost(FIXTURE_REPO, findings, "claude-opus-5-5", "anthropic");

    expect(est.findings).toBe(1);
    expect(est.estimatedInputTokens).toBeGreaterThan(0);
    expect(est.breakdown.contextTokens).toBeGreaterThan(0);
  });

  it("sets low confidence for many findings", async () => {
    const findings: Finding[] = Array.from({ length: 25 }, (_, i) =>
      makeFinding(`file${i}.js`, 1),
    );
    const est = await estimateMigrationCost(FIXTURE_REPO, findings, "claude-opus-5-5", "anthropic");
    expect(est.confidence).toBe("low");
  });

  it("sets medium confidence for moderate findings", async () => {
    const findings: Finding[] = Array.from({ length: 10 }, (_, i) =>
      makeFinding(`file${i % 5}.js`, i),
    );
    const est = await estimateMigrationCost(FIXTURE_REPO, findings, "claude-opus-5-5", "anthropic");
    expect(est.confidence).toBe("medium");
  });
});
