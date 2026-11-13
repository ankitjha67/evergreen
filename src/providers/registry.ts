// FR-09.1 - Provider registry: factory, presets, and discovery
import { LLMProvider, ProviderConfig, ProviderPreset } from "./types.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";
import { OPENAI_COMPAT_PRESETS, resolveOpenAICompatProvider, OpenAICompatPresetId } from "./openai-compat.js";

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic Claude",
    factory: (c) => new AnthropicProvider(c),
    defaultModel: "claude-opus-5-5",
    envKeys: { apiKey: "ANTHROPIC_API_KEY" },
    description: "Anthropic Claude - frontier models for complex reasoning and code",
    supportsToolUse: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    factory: (c) => new OpenAIProvider(c),
    defaultModel: "gpt-4o",
    envKeys: { apiKey: "OPENAI_API_KEY" },
    description: "OpenAI GPT models - GPT-4o, o3, GPT-5",
    supportsToolUse: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    factory: (c) => new GeminiProvider(c),
    defaultModel: "gemini-2.5-pro",
    envKeys: { apiKey: "GOOGLE_API_KEY" },
    description: "Google Gemini - multimodal models with large context",
    supportsToolUse: true,
  },
  // OpenAI-compatible presets
  ...Object.values(OPENAI_COMPAT_PRESETS).map((p) => ({
    id: p.id,
    name: p.name,
    factory: (c: ProviderConfig) => resolveOpenAICompatProvider(p.id as OpenAICompatPresetId, c),
    defaultModel: p.defaultModel,
    envKeys: p.envKeys as { apiKey?: string; baseUrl?: string },
    description: p.description,
    supportsToolUse: true,
    local: p.local,
  })),
];

export function getProvider(id: string, config: ProviderConfig = {}): LLMProvider {
  const preset = PROVIDER_PRESETS.find((p) => p.id === id);
  if (!preset) {
    throw new Error(`Unknown provider "${id}". Available: ${PROVIDER_PRESETS.map((p) => p.id).join(", ")}`);
  }
  return preset.factory(config);
}

export function listProviders(): ProviderPreset[] {
  return PROVIDER_PRESETS;
}

export function listAvailableProviders(): { preset: ProviderPreset; configured: boolean }[] {
  return PROVIDER_PRESETS.map((preset) => {
    let configured = false;
    if (preset.local) {
      configured = true;
    } else if (preset.envKeys.apiKey) {
      configured = !!process.env[preset.envKeys.apiKey];
    }
    return { preset, configured };
  });
}

export function resolveProvider(config: ProviderConfig & { provider?: string }): LLMProvider {
  const id = config.provider ?? process.env.MIGRATION_PROVIDER ?? "anthropic";
  return getProvider(id, config);
}
