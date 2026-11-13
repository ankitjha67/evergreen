// Mock LLM provider for integration testing the agent loop.
// Simulates a migration agent that reads a file, edits it, and writes a manifest.
import { LLMProvider, ChatMessage, ToolDef, ChatOptions, ChatResponse, ToolCall } from "../src/providers/types.js";

type ScriptStep =
  | { type: "tool_calls"; calls: ToolCall[] }
  | { type: "text"; content: string };

export class MockProvider implements LLMProvider {
  readonly id = "mock";
  readonly name = "Mock Provider";
  readonly defaultModel = "mock-v1";
  readonly supportsToolUse = true;

  private script: ScriptStep[];
  private turn = 0;

  constructor(script: ScriptStep[]) {
    this.script = script;
  }

  async chat(_messages: ChatMessage[], _tools?: ToolDef[], _options?: ChatOptions): Promise<ChatResponse> {
    const step = this.script[this.turn++];
    if (!step) {
      return { content: "Done.", toolCalls: [], finishReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 } };
    }

    if (step.type === "tool_calls") {
      return {
        content: "",
        toolCalls: step.calls,
        finishReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 50 },
      };
    }

    return {
      content: step.content,
      toolCalls: [],
      finishReason: "end_turn",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
  }
}

export function createMigrationMockScript(manifestContent: string): ScriptStep[] {
  return [
    // Turn 1: Read the target file
    {
      type: "tool_calls",
      calls: [{ id: "call_1", name: "Read", arguments: { path: "src/billing.ts" } }],
    },
    // Turn 2: Edit the target file
    {
      type: "tool_calls",
      calls: [{
        id: "call_2",
        name: "Edit",
        arguments: {
          path: "src/billing.ts",
          old_string: "charges.create",
          new_string: "paymentIntents.create",
        },
      }],
    },
    // Turn 3: Write the manifest
    {
      type: "tool_calls",
      calls: [{
        id: "call_3",
        name: "Write",
        arguments: {
          path: ".evergreen/manifest.json",
          content: manifestContent,
        },
      }],
    },
    // Turn 4: Done
    {
      type: "text",
      content: "Migration complete. Replaced charges.create with paymentIntents.create in src/billing.ts.",
    },
  ];
}
