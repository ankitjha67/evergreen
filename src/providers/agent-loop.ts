// FR-09.1 - Provider-agnostic agentic migration loop.
// Sends the migration prompt, processes tool calls iteratively, returns the final text + usage.
import { LLMProvider, ChatMessage, ToolResult, ChatOptions } from "./types.js";
import { MIGRATION_TOOLS, executeTool } from "./tools.js";
import { TokenUsage } from "../types.js";
import { PROVIDER_PRICING, PricingTier } from "./types.js";

export interface AgentLoopOptions {
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface AgentLoopResult {
  finalText: string;
  usage: TokenUsage;
  turns: number;
}

export async function runAgentLoop(
  provider: LLMProvider,
  systemPrompt: string,
  userPrompt: string,
  repoRoot: string,
  model: string,
  opts: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
  const maxTurns = opts.maxTurns ?? 60;
  let totalInput = 0;
  let totalOutput = 0;
  let turns = 0;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const chatOpts: ChatOptions = {
    maxTokens: opts.maxTokens ?? 16384,
    temperature: opts.temperature ?? 0,
  };

  const tools = provider.supportsToolUse ? MIGRATION_TOOLS : undefined;

  for (let turn = 0; turn < maxTurns; turn++) {
    turns++;
    const response = await provider.chat(messages, tools, chatOpts);
    totalInput += response.usage.inputTokens;
    totalOutput += response.usage.outputTokens;

    if (response.toolCalls.length === 0 || response.finishReason === "end_turn" || response.finishReason === "stop") {
      const pricing = PROVIDER_PRICING[model] ?? { inputPerMTok: 0, outputPerMTok: 0 };
      return {
        finalText: response.content,
        usage: computeUsage(totalInput, totalOutput, pricing),
        turns,
      };
    }

    messages.push({
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
    });

    const results: ToolResult[] = [];
    for (const call of response.toolCalls) {
      const result = await executeTool(call, repoRoot);
      results.push(result);
    }

    for (const result of results) {
      messages.push({
        role: "tool",
        content: result.content,
        toolCallId: result.toolCallId,
      });
    }
  }

  const pricing = PROVIDER_PRICING[model] ?? { inputPerMTok: 0, outputPerMTok: 0 };
  return {
    finalText: messages.filter((m) => m.role === "assistant").pop()?.content ?? "",
    usage: computeUsage(totalInput, totalOutput, pricing),
    turns,
  };
}

function computeUsage(input: number, output: number, pricing: PricingTier): TokenUsage {
  const costUSD =
    (input / 1e6) * pricing.inputPerMTok +
    (output / 1e6) * pricing.outputPerMTok;
  return {
    inputTokens: input,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: output,
    costUSD: Number(costUSD.toFixed(4)),
  };
}
