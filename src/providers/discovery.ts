// FR-09.3 - Dynamic model discovery and cross-provider fallback
import { LLMProvider, ModelInfo, ChatMessage, ChatResponse, ToolDef, ChatOptions, ProviderConfig } from "./types.js";

const modelCache = new Map<string, { models: ModelInfo[]; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function discoverModels(provider: LLMProvider): Promise<ModelInfo[]> {
  const cached = modelCache.get(provider.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.models;
  }

  if (!provider.listModels) return [];

  try {
    const models = await provider.listModels();
    if (models.length > 0) {
      modelCache.set(provider.id, { models, fetchedAt: Date.now() });
    }
    return models;
  } catch {
    return [];
  }
}

export function clearModelCache(providerId?: string): void {
  if (providerId) {
    modelCache.delete(providerId);
  } else {
    modelCache.clear();
  }
}

export function selectBestModel(models: ModelInfo[], preferredModel?: string): string | undefined {
  if (models.length === 0) return undefined;

  if (preferredModel) {
    const exact = models.find((m) => m.id === preferredModel);
    if (exact) return exact.id;
  }

  // Prefer models with larger context windows for migration tasks
  const sorted = [...models].sort((a, b) => (b.contextWindow ?? 0) - (a.contextWindow ?? 0));
  return sorted[0].id;
}

export class FallbackProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly defaultModel: string;
  readonly supportsToolUse: boolean;
  private providers: LLMProvider[];

  constructor(providers: LLMProvider[]) {
    if (providers.length === 0) throw new Error("FallbackProvider requires at least one provider");
    this.providers = providers;
    const primary = providers[0];
    this.id = `fallback(${providers.map((p) => p.id).join(",")})`;
    this.name = `${primary.name} (with ${providers.length - 1} fallback${providers.length > 2 ? "s" : ""})`;
    this.defaultModel = primary.defaultModel;
    this.supportsToolUse = primary.supportsToolUse;
  }

  async listModels(): Promise<ModelInfo[]> {
    for (const provider of this.providers) {
      if (!provider.listModels) continue;
      const models = await provider.listModels();
      if (models.length > 0) return models;
    }
    return [];
  }

  async chat(messages: ChatMessage[], tools?: ToolDef[], options?: ChatOptions): Promise<ChatResponse> {
    const errors: { providerId: string; error: string }[] = [];

    for (const provider of this.providers) {
      try {
        return await provider.chat(messages, tools, options);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        errors.push({ providerId: provider.id, error: msg });

        // Only retry on transient/model errors, not auth errors from a different provider
        const isRetryable = !msg.includes("API key") || this.providers.indexOf(provider) === 0;
        if (!isRetryable) continue;
      }
    }

    const detail = errors.map((e) => `  ${e.providerId}: ${e.error}`).join("\n");
    throw new Error(`All ${this.providers.length} providers failed:\n${detail}`);
  }
}
