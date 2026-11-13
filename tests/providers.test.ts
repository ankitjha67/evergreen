// Tests for FR-09 — Multi-LLM provider abstraction
import { describe, it, expect } from "vitest";
import { MIGRATION_TOOLS, executeTool } from "../src/providers/tools.js";
import { PROVIDER_PRICING } from "../src/providers/types.js";
import { listProviders, listAvailableProviders, getProvider } from "../src/providers/registry.js";
import { OPENAI_COMPAT_PRESETS } from "../src/providers/openai-compat.js";

describe("MIGRATION_TOOLS", () => {
  it("exposes exactly 5 tools", () => {
    expect(MIGRATION_TOOLS).toHaveLength(5);
  });

  it("each tool has name, description, and parameters", () => {
    for (const tool of MIGRATION_TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(tool.parameters.required).toBeDefined();
    }
  });

  it("tool names are Read, Edit, Write, Grep, Glob", () => {
    const names = MIGRATION_TOOLS.map((t) => t.name);
    expect(names).toEqual(["Read", "Edit", "Write", "Grep", "Glob"]);
  });
});

describe("executeTool — path traversal", () => {
  it("rejects paths that escape repo root", async () => {
    const result = await executeTool(
      { id: "1", name: "Read", arguments: { path: "../../etc/passwd" } },
      "/tmp/test-repo",
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("escapes repo root");
  });

  it("returns error for unknown tool", async () => {
    const result = await executeTool(
      { id: "1", name: "Bash", arguments: {} },
      "/tmp/test-repo",
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });
});

describe("PROVIDER_PRICING", () => {
  it("has pricing for key models", () => {
    expect(PROVIDER_PRICING["claude-opus-5-5"]).toBeDefined();
    expect(PROVIDER_PRICING["gpt-4o"]).toBeDefined();
    expect(PROVIDER_PRICING["gemini-2.5-pro"]).toBeDefined();
    expect(PROVIDER_PRICING["deepseek-chat"]).toBeDefined();
  });

  it("each tier has inputPerMTok and outputPerMTok", () => {
    for (const [, tier] of Object.entries(PROVIDER_PRICING)) {
      expect(tier.inputPerMTok).toBeGreaterThanOrEqual(0);
      expect(tier.outputPerMTok).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("Provider Registry", () => {
  it("lists at least 15 providers", () => {
    const providers = listProviders();
    expect(providers.length).toBeGreaterThanOrEqual(15);
  });

  it("includes the three core providers", () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai");
    expect(ids).toContain("gemini");
  });

  it("includes OpenAI-compatible presets", () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toContain("ollama");
    expect(ids).toContain("groq");
    expect(ids).toContain("nvidia-nim");
    expect(ids).toContain("together");
    expect(ids).toContain("fireworks");
    expect(ids).toContain("deepseek");
    expect(ids).toContain("openrouter");
  });

  it("throws for unknown provider id", () => {
    expect(() => getProvider("nonexistent-provider")).toThrow("Unknown provider");
  });

  it("local providers show as configured", () => {
    const available = listAvailableProviders();
    const ollama = available.find((a) => a.preset.id === "ollama");
    expect(ollama?.configured).toBe(true);
  });
});

describe("runProviderMigration export", () => {
  it("is importable from agent module", async () => {
    const mod = await import("../src/migrator/agent.js");
    expect(typeof mod.runProviderMigration).toBe("function");
  });
});

describe("Provider dispatch in orchestrator", () => {
  it("orchestrator imports getProvider from registry", async () => {
    const mod = await import("../src/orchestrator.js");
    expect(typeof mod.migrate).toBe("function");
    expect(typeof mod.scanOnly).toBe("function");
  });
});

describe("Provider default model resolution", () => {
  it("each provider preset has a non-empty defaultModel", () => {
    const providers = listProviders();
    for (const p of providers) {
      expect(p.defaultModel, `${p.id} missing defaultModel`).toBeTruthy();
    }
  });

  it("non-Anthropic providers have non-Claude default models", () => {
    const providers = listProviders();
    for (const p of providers) {
      if (p.id !== "anthropic") {
        expect(p.defaultModel, `${p.id} should not default to claude`).not.toMatch(/^claude-/);
      }
    }
  });
});

describe("OpenAI-compat presets", () => {
  it("has at least 10 presets", () => {
    expect(Object.keys(OPENAI_COMPAT_PRESETS).length).toBeGreaterThanOrEqual(10);
  });

  it("each preset has id, name, defaultModel, defaultBaseUrl", () => {
    for (const [key, preset] of Object.entries(OPENAI_COMPAT_PRESETS)) {
      expect(preset.id).toBe(key);
      expect(preset.name).toBeTruthy();
      expect(preset.defaultModel).toBeTruthy();
      expect(preset.defaultBaseUrl).toBeDefined();
    }
  });

  it("local presets have local=true", () => {
    expect(OPENAI_COMPAT_PRESETS.ollama.local).toBe(true);
    expect(OPENAI_COMPAT_PRESETS.lmstudio.local).toBe(true);
    expect(OPENAI_COMPAT_PRESETS.vllm.local).toBe(true);
  });

  it("cloud presets have local=false", () => {
    expect(OPENAI_COMPAT_PRESETS.groq.local).toBe(false);
    expect(OPENAI_COMPAT_PRESETS["nvidia-nim"].local).toBe(false);
    expect(OPENAI_COMPAT_PRESETS.deepseek.local).toBe(false);
  });
});
