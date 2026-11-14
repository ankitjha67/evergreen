// FR-09.2 - Anthropic Claude provider via Messages API
import { LLMProvider, ChatMessage, ChatResponse, ToolDef, ChatOptions, ToolCall, ProviderConfig, ModelInfo } from "./types.js";

export class AnthropicProvider implements LLMProvider {
  readonly id = "anthropic";
  readonly name = "Anthropic Claude";
  readonly defaultModel = "claude-opus-5-5";
  readonly supportsToolUse = true;
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is required for the Anthropic provider");
  }

  async listModels(): Promise<ModelInfo[]> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });
    try {
      const response = await client.models.list({ limit: 100 });
      return response.data.map((m: any) => ({
        id: m.id,
        name: m.display_name ?? m.id,
        contextWindow: m.context_window,
        maxOutputTokens: m.max_output,
      }));
    } catch {
      return [];
    }
  }

  async chat(messages: ChatMessage[], tools?: ToolDef[], options?: ChatOptions): Promise<ChatResponse> {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    const systemMsg = messages.find((m) => m.role === "system");
    const apiMessages = convertMessages(messages.filter((m) => m.role !== "system"));

    const params: any = {
      model: undefined as any, // set below
      max_tokens: options?.maxOutputTokens ?? options?.maxTokens ?? 16384,
      messages: apiMessages,
    };
    if (systemMsg) params.system = systemMsg.content;
    if (tools?.length) {
      params.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    if (options?.temperature !== undefined) params.temperature = options.temperature;

    // Model comes from the agent loop, defaulting to our default
    params.model = this.defaultModel;

    const response = await client.messages.create(params);

    const content: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        content.push(block.text);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: content.join(""),
      toolCalls,
      finishReason: response.stop_reason === "tool_use" ? "tool_use" : "end_turn",
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

function convertMessages(messages: ChatMessage[]): any[] {
  const result: any[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      const content: any[] = [];
      if (msg.content) content.push({ type: "text", text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
        }
      }
      result.push({ role: "assistant", content });
    } else if (msg.role === "tool") {
      result.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.toolCallId, content: msg.content }],
      });
    } else {
      result.push({ role: msg.role, content: msg.content });
    }
  }

  // Anthropic requires consecutive tool results to be in one user message
  return mergeConsecutiveToolResults(result);
}

function mergeConsecutiveToolResults(messages: any[]): any[] {
  const merged: any[] = [];
  for (const msg of messages) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.role === "user" &&
      Array.isArray(prev.content) &&
      prev.content[0]?.type === "tool_result" &&
      msg.role === "user" &&
      Array.isArray(msg.content) &&
      msg.content[0]?.type === "tool_result"
    ) {
      prev.content.push(...msg.content);
    } else {
      merged.push(msg);
    }
  }
  return merged;
}
