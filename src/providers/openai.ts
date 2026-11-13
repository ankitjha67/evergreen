// FR-09.2 — OpenAI provider (GPT-4o, o1, o3, GPT-5)
import { LLMProvider, ChatMessage, ChatResponse, ToolDef, ChatOptions, ToolCall, ProviderConfig } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  readonly supportsToolUse = true;
  private apiKey: string;
  private baseUrl?: string;
  private organization?: string;
  private headers?: Record<string, string>;

  constructor(config: ProviderConfig, preset?: { id: string; name: string; defaultModel: string }) {
    this.id = preset?.id ?? "openai";
    this.name = preset?.name ?? "OpenAI";
    this.defaultModel = config.model ?? preset?.defaultModel ?? "gpt-4o";
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = config.baseUrl;
    this.organization = config.organization;
    this.headers = config.headers;
    if (!this.apiKey && !config.baseUrl?.includes("localhost")) {
      throw new Error(`API key required for ${this.name} provider`);
    }
  }

  async chat(messages: ChatMessage[], tools?: ToolDef[], options?: ChatOptions): Promise<ChatResponse> {
    const { default: OpenAI } = await import("openai");
    const clientOpts: any = { apiKey: this.apiKey || "not-needed" };
    if (this.baseUrl) clientOpts.baseURL = this.baseUrl;
    if (this.organization) clientOpts.organization = this.organization;
    if (this.headers) clientOpts.defaultHeaders = this.headers;
    const client = new OpenAI(clientOpts);

    const apiMessages = convertMessages(messages);
    const params: any = {
      model: this.defaultModel,
      messages: apiMessages,
      max_tokens: options?.maxTokens ?? 16384,
    };

    if (tools?.length) {
      params.tools = tools.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    if (options?.temperature !== undefined) params.temperature = options.temperature;

    const response = await client.chat.completions.create(params);
    const choice = response.choices[0];

    const toolCalls: ToolCall[] = [];
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const tcAny = tc as any;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tcAny.function.arguments); } catch { /* partial */ }
        toolCalls.push({ id: tcAny.id, name: tcAny.function.name, arguments: args });
      }
    }

    return {
      content: choice.message.content ?? "",
      toolCalls,
      finishReason: choice.finish_reason === "tool_calls" ? "tool_use" : "end_turn",
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
}

function convertMessages(messages: ChatMessage[]): any[] {
  const result: any[] = [];
  for (const msg of messages) {
    if (msg.role === "system") {
      result.push({ role: "system", content: msg.content });
    } else if (msg.role === "user") {
      result.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      const entry: any = { role: "assistant" };
      if (msg.content) entry.content = msg.content;
      if (msg.toolCalls?.length) {
        entry.tool_calls = msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }));
      }
      result.push(entry);
    } else if (msg.role === "tool") {
      result.push({ role: "tool", tool_call_id: msg.toolCallId, content: msg.content });
    }
  }
  return result;
}
