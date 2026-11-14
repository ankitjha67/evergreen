// FR-09.2 - Google Gemini provider via @google/generative-ai SDK
import { LLMProvider, ChatMessage, ChatResponse, ToolDef, ChatOptions, ToolCall, ProviderConfig } from "./types.js";

export class GeminiProvider implements LLMProvider {
  readonly id = "gemini";
  readonly name = "Google Gemini";
  readonly defaultModel: string;
  readonly supportsToolUse = true;
  private apiKey: string;

  constructor(config: ProviderConfig) {
    this.defaultModel = config.model ?? "gemini-2.5-pro";
    this.apiKey = config.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
    if (!this.apiKey) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is required for the Gemini provider");
  }

  async chat(messages: ChatMessage[], tools?: ToolDef[], options?: ChatOptions): Promise<ChatResponse> {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(this.apiKey);

    const systemMsg = messages.find((m) => m.role === "system");
    const model = genAI.getGenerativeModel({
      model: this.defaultModel,
      ...(systemMsg ? { systemInstruction: systemMsg.content } : {}),
    });

    const geminiTools = tools?.length
      ? [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }]
      : undefined;

    const contents = convertMessages(messages.filter((m) => m.role !== "system"));

    const request: any = {
      contents,
      generationConfig: {
        maxOutputTokens: options?.maxTokens ?? 16384,
        ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
      },
    };
    if (geminiTools) request.tools = geminiTools;

    const result = await model.generateContent(request);

    const response = result.response;
    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    let textContent = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if ("text" in part && part.text) {
        textContent += part.text;
      } else if ("functionCall" in part && part.functionCall) {
        toolCalls.push({
          id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name,
          arguments: (part.functionCall.args as Record<string, unknown>) ?? {},
        });
      }
    }

    const finishReason = toolCalls.length > 0 ? "tool_use" as const : "end_turn" as const;
    const usage = response.usageMetadata;

    return {
      content: textContent,
      toolCalls,
      finishReason,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
      },
    };
  }
}

function convertMessages(messages: ChatMessage[]): any[] {
  const contents: any[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      const parts: any[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
        }
      }
      contents.push({ role: "model", parts });
    } else if (msg.role === "tool") {
      contents.push({
        role: "function",
        parts: [{ functionResponse: { name: "tool", response: { result: msg.content } } }],
      });
    }
  }

  return contents;
}
