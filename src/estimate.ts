// FR-06 - Migration cost estimation: estimate LLM cost before running a migration
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Finding } from "./types.js";
import { PROVIDER_PRICING, PricingTier } from "./providers/types.js";
import { DEFAULTS } from "./config.js";

export interface CostEstimate {
  model: string;
  provider: string;
  findings: number;
  affectedFiles: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUSD: number;
  breakdown: {
    promptBaseTokens: number;
    contextTokens: number;
    outputTokens: number;
  };
  pricing: PricingTier | null;
  confidence: "high" | "medium" | "low";
}

const AVG_TOKENS_PER_LINE = 5;
const CONTEXT_LINES_PER_FINDING = 20;
const PROMPT_BASE_TOKENS = 2000;
const MANIFEST_OUTPUT_TOKENS = 500;
const PER_FILE_OUTPUT_TOKENS = 300;

export async function estimateMigrationCost(
  repo: string,
  findings: Finding[],
  model: string,
  provider: string,
): Promise<CostEstimate> {
  const affectedFiles = [...new Set(findings.map((f) => f.file))];

  let contextTokens = 0;
  for (const file of affectedFiles) {
    try {
      const abs = join(repo, file);
      const st = await stat(abs);
      if (st.size > DEFAULTS.maxFileBytes) continue;
      const content = await readFile(abs, "utf8");
      const lines = content.split(/\r?\n/).length;
      contextTokens += Math.min(lines, 500) * AVG_TOKENS_PER_LINE;
    } catch {
      contextTokens += CONTEXT_LINES_PER_FINDING * AVG_TOKENS_PER_LINE * findings.filter((f) => f.file === file).length;
    }
  }

  const promptBaseTokens = PROMPT_BASE_TOKENS + findings.length * CONTEXT_LINES_PER_FINDING * AVG_TOKENS_PER_LINE;
  const estimatedInputTokens = promptBaseTokens + contextTokens;
  const estimatedOutputTokens = MANIFEST_OUTPUT_TOKENS + affectedFiles.length * PER_FILE_OUTPUT_TOKENS;

  const pricing = PROVIDER_PRICING[model] ?? null;
  let estimatedCostUSD = 0;
  if (pricing) {
    estimatedCostUSD = (estimatedInputTokens / 1_000_000) * pricing.inputPerMTok
      + (estimatedOutputTokens / 1_000_000) * pricing.outputPerMTok;
  }

  let confidence: "high" | "medium" | "low" = "medium";
  if (findings.length <= 5 && affectedFiles.length <= 3) confidence = "high";
  else if (findings.length > 20 || affectedFiles.length > 10) confidence = "low";

  return {
    model,
    provider,
    findings: findings.length,
    affectedFiles: affectedFiles.length,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUSD: Number(estimatedCostUSD.toFixed(4)),
    breakdown: { promptBaseTokens, contextTokens, outputTokens: estimatedOutputTokens },
    pricing,
    confidence,
  };
}
