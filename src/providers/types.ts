// FR-09.1 - Multi-LLM provider abstraction (FSD.md FR-09, SYSTEM_DESIGN.md §9)

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  thinking?: boolean;
}

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  finishReason: "end_turn" | "tool_use" | "max_tokens" | "stop";
  usage: { inputTokens: number; outputTokens: number };
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  organization?: string;
  headers?: Record<string, string>;
}

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  readonly supportsToolUse: boolean;

  chat(messages: ChatMessage[], tools?: ToolDef[], options?: ChatOptions): Promise<ChatResponse>;
}

export interface ProviderPreset {
  id: string;
  name: string;
  factory: (config: ProviderConfig) => LLMProvider;
  defaultModel: string;
  envKeys: { apiKey?: string; baseUrl?: string };
  description: string;
  supportsToolUse: boolean;
  local?: boolean;
}

export interface PricingTier {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
}

export const PROVIDER_PRICING: Record<string, PricingTier> = {
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
  "claude-sonnet-5-5": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWritePerMTok: 3.75 },
  "claude-haiku-5-5": { inputPerMTok: 0.8, outputPerMTok: 4, cacheReadPerMTok: 0.08, cacheWritePerMTok: 1 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "o3": { inputPerMTok: 10, outputPerMTok: 40 },
  "o3-mini": { inputPerMTok: 1.1, outputPerMTok: 4.4 },
  "gemini-2.5-pro": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gemini-2.5-flash": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "deepseek-chat": { inputPerMTok: 0.27, outputPerMTok: 1.1 },
  "deepseek-reasoner": { inputPerMTok: 0.55, outputPerMTok: 2.19 },
  "llama-3.3-70b": { inputPerMTok: 0.59, outputPerMTok: 0.79 },
  "mistral-large": { inputPerMTok: 2, outputPerMTok: 6 },
  "qwen-2.5-72b": { inputPerMTok: 0.59, outputPerMTok: 0.79 },
};
