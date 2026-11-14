// Cost comparison - compare estimated migration costs across models/providers
import { Finding } from "./types.js";
import { estimateMigrationCost, type CostEstimate } from "./estimate.js";
import { PROVIDER_PRICING } from "./providers/types.js";

export interface CostComparison {
  models: CostEstimate[];
  cheapest: { model: string; costUSD: number };
  mostExpensive: { model: string; costUSD: number };
  findings: number;
  affectedFiles: number;
}

const COMPARISON_MODELS: { model: string; provider: string }[] = [
  { model: "claude-opus-5-5", provider: "anthropic" },
  { model: "claude-sonnet-5-5", provider: "anthropic" },
  { model: "claude-haiku-5-5", provider: "anthropic" },
  { model: "gpt-4o", provider: "openai" },
  { model: "gpt-4o-mini", provider: "openai" },
  { model: "gemini-2.5-pro", provider: "gemini" },
  { model: "gemini-2.5-flash", provider: "gemini" },
  { model: "deepseek-chat", provider: "deepseek" },
  { model: "llama-3.3-70b", provider: "groq" },
];

export async function compareCosts(
  repo: string,
  findings: Finding[],
  models?: string[],
): Promise<CostComparison> {
  const toCompare = models
    ? models.map((m) => {
        const known = COMPARISON_MODELS.find((cm) => cm.model === m);
        return known ?? { model: m, provider: "unknown" };
      })
    : COMPARISON_MODELS.filter((m) => PROVIDER_PRICING[m.model]);

  const estimates: CostEstimate[] = [];

  for (const { model, provider } of toCompare) {
    try {
      const est = await estimateMigrationCost(repo, findings, model, provider);
      estimates.push(est);
    } catch {
      // Skip models that fail estimation
    }
  }

  if (estimates.length === 0) {
    const affectedFiles = [...new Set(findings.map((f) => f.file))].length;
    return {
      models: [],
      cheapest: { model: "none", costUSD: 0 },
      mostExpensive: { model: "none", costUSD: 0 },
      findings: findings.length,
      affectedFiles,
    };
  }

  const sorted = [...estimates].sort((a, b) => a.estimatedCostUSD - b.estimatedCostUSD);

  return {
    models: sorted,
    cheapest: { model: sorted[0].model, costUSD: sorted[0].estimatedCostUSD },
    mostExpensive: { model: sorted[sorted.length - 1].model, costUSD: sorted[sorted.length - 1].estimatedCostUSD },
    findings: findings.length,
    affectedFiles: sorted[0].affectedFiles,
  };
}

export function formatCostComparison(comparison: CostComparison): string {
  if (comparison.models.length === 0) {
    return "No models available for cost comparison.";
  }

  const lines: string[] = [
    `Cost Comparison: ${comparison.findings} finding(s) across ${comparison.affectedFiles} file(s)`,
    "─".repeat(70),
    "",
    "  Model                    Provider    Est. Input   Est. Output    Est. Cost",
    "  " + "─".repeat(66),
  ];

  for (const m of comparison.models) {
    const modelCol = m.model.padEnd(25);
    const providerCol = m.provider.padEnd(12);
    const inputCol = m.estimatedInputTokens.toLocaleString().padStart(10);
    const outputCol = m.estimatedOutputTokens.toLocaleString().padStart(10);
    const costCol = `$${m.estimatedCostUSD.toFixed(4)}`.padStart(12);
    lines.push(`  ${modelCol}${providerCol}${inputCol}   ${outputCol}   ${costCol}`);
  }

  lines.push("");
  lines.push(`  Cheapest:        ${comparison.cheapest.model} ($${comparison.cheapest.costUSD.toFixed(4)})`);
  lines.push(`  Most expensive:  ${comparison.mostExpensive.model} ($${comparison.mostExpensive.costUSD.toFixed(4)})`);

  if (comparison.cheapest.costUSD > 0 && comparison.mostExpensive.costUSD > 0) {
    const ratio = comparison.mostExpensive.costUSD / comparison.cheapest.costUSD;
    lines.push(`  Price range:     ${ratio.toFixed(1)}x difference`);
  }

  return lines.join("\n");
}
