// FR-09.2 — OpenAI-compatible provider: covers Ollama, NVIDIA NIM, Groq, Together AI,
// Fireworks AI, DeepSeek, LM Studio, vLLM, Anyscale, Perplexity, Mistral, Azure OpenAI, etc.
import { OpenAIProvider } from "./openai.js";
import { ProviderConfig } from "./types.js";

export function createOpenAICompatibleProvider(
  config: ProviderConfig,
  preset: { id: string; name: string; defaultModel: string },
): OpenAIProvider {
  return new OpenAIProvider(config, preset);
}

// Pre-built presets for common providers
export const OPENAI_COMPAT_PRESETS = {
  // Local providers
  ollama: {
    id: "ollama",
    name: "Ollama (Local)",
    defaultModel: "llama3.3:70b",
    envKeys: { baseUrl: "OLLAMA_BASE_URL" },
    defaultBaseUrl: "http://localhost:11434/v1",
    description: "Local models via Ollama — no API key, runs on your machine",
    local: true,
  },
  lmstudio: {
    id: "lmstudio",
    name: "LM Studio (Local)",
    defaultModel: "local-model",
    envKeys: { baseUrl: "LMSTUDIO_BASE_URL" },
    defaultBaseUrl: "http://localhost:1234/v1",
    description: "Local models via LM Studio",
    local: true,
  },
  vllm: {
    id: "vllm",
    name: "vLLM (Local/Self-hosted)",
    defaultModel: "default",
    envKeys: { baseUrl: "VLLM_BASE_URL" },
    defaultBaseUrl: "http://localhost:8000/v1",
    description: "Self-hosted models via vLLM inference server",
    local: true,
  },

  // Cloud providers (OpenAI-compatible)
  "nvidia-nim": {
    id: "nvidia-nim",
    name: "NVIDIA NIM",
    defaultModel: "meta/llama-3.3-70b-instruct",
    envKeys: { apiKey: "NVIDIA_API_KEY", baseUrl: "NVIDIA_BASE_URL" },
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    description: "NVIDIA NIM — enterprise-grade inference for open models",
    local: false,
  },
  groq: {
    id: "groq",
    name: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    envKeys: { apiKey: "GROQ_API_KEY" },
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    description: "Groq — ultra-fast LPU inference",
    local: false,
  },
  together: {
    id: "together",
    name: "Together AI",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    envKeys: { apiKey: "TOGETHER_API_KEY" },
    defaultBaseUrl: "https://api.together.xyz/v1",
    description: "Together AI — open model inference and fine-tuning",
    local: false,
  },
  fireworks: {
    id: "fireworks",
    name: "Fireworks AI",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    envKeys: { apiKey: "FIREWORKS_API_KEY" },
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    description: "Fireworks AI — fast generative AI inference",
    local: false,
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    defaultModel: "deepseek-chat",
    envKeys: { apiKey: "DEEPSEEK_API_KEY" },
    defaultBaseUrl: "https://api.deepseek.com/v1",
    description: "DeepSeek — high-quality reasoning models",
    local: false,
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    defaultModel: "mistral-large-latest",
    envKeys: { apiKey: "MISTRAL_API_KEY" },
    defaultBaseUrl: "https://api.mistral.ai/v1",
    description: "Mistral AI — European frontier AI lab",
    local: false,
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    defaultModel: "llama-3.1-sonar-large-128k-online",
    envKeys: { apiKey: "PERPLEXITY_API_KEY" },
    defaultBaseUrl: "https://api.perplexity.ai",
    description: "Perplexity — search-augmented AI models",
    local: false,
  },
  anyscale: {
    id: "anyscale",
    name: "Anyscale",
    defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct",
    envKeys: { apiKey: "ANYSCALE_API_KEY" },
    defaultBaseUrl: "https://api.endpoints.anyscale.com/v1",
    description: "Anyscale Endpoints — scalable model serving",
    local: false,
  },
  "azure-openai": {
    id: "azure-openai",
    name: "Azure OpenAI",
    defaultModel: "gpt-4o",
    envKeys: { apiKey: "AZURE_OPENAI_API_KEY", baseUrl: "AZURE_OPENAI_ENDPOINT" },
    defaultBaseUrl: "",
    description: "Azure OpenAI Service — enterprise deployment of OpenAI models",
    local: false,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    defaultModel: "anthropic/claude-opus-5-5",
    envKeys: { apiKey: "OPENROUTER_API_KEY" },
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    description: "OpenRouter — unified API for 200+ models",
    local: false,
  },
} as const;

export type OpenAICompatPresetId = keyof typeof OPENAI_COMPAT_PRESETS;

export function resolveOpenAICompatProvider(presetId: OpenAICompatPresetId, config: ProviderConfig = {}): OpenAIProvider {
  const preset = OPENAI_COMPAT_PRESETS[presetId];
  const envKeys = preset.envKeys as Record<string, string>;
  const apiKey = config.apiKey ?? (envKeys.apiKey ? process.env[envKeys.apiKey] : undefined) ?? "";
  const baseUrl =
    config.baseUrl ??
    (envKeys.baseUrl ? process.env[envKeys.baseUrl] : undefined) ??
    preset.defaultBaseUrl;

  return new OpenAIProvider(
    { apiKey, baseUrl, model: config.model ?? preset.defaultModel, headers: config.headers },
    { id: preset.id, name: preset.name, defaultModel: config.model ?? preset.defaultModel },
  );
}
