// FR-07.2 - Repo config (.evergreen.json) + precedence: CLI flag > repo config > defaults
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RepoConfig } from "./types.js";

export const DEFAULTS = {
  model: "claude-opus-5-5",
  triageModel: "claude-haiku-5-5",
  confidenceThreshold: 0.8,
  // Opus 5.5 pricing per MTok (claude-api skill, 2026-11): input $4, cache read $0.20, cache write $5, output $20
  pricing: { inputPerMTok: 4, cacheReadPerMTok: 0.2, cacheCreationPerMTok: 5, outputPerMTok: 20 },
  excludes: [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.evergreen/**",
    "**/*.lock",
    "**/package-lock.json",
    "**/yarn.lock",
    "**/pnpm-lock.yaml",
  ],
  maxFileBytes: 1024 * 1024,
  agentMaxTurns: 60,
} as const;

export async function loadRepoConfig(repo: string): Promise<RepoConfig> {
  // Try .evergreen.json first (original format)
  try {
    const raw = await readFile(join(repo, ".evergreen.json"), "utf8");
    const cfg = JSON.parse(raw) as RepoConfig;
    if (cfg.confidenceThreshold !== undefined && (cfg.confidenceThreshold < 0 || cfg.confidenceThreshold > 1)) {
      throw new Error(".evergreen.json: confidenceThreshold must be between 0 and 1");
    }
    return cfg;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  // Fall back to .evergreen.yaml
  try {
    const raw = await readFile(join(repo, ".evergreen.yaml"), "utf8");
    return parseYamlConfig(raw);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

export function parseYamlConfig(content: string): RepoConfig {
  const config: RepoConfig = {};
  const ignoreList: string[] = [];
  const fallbackList: string[] = [];
  let currentList: "ignore" | "fallback" | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.split("#")[0].trimEnd();
    if (!line.trim()) { currentList = null; continue; }

    if (currentList) {
      const match = line.match(/^\s+-\s+(.+)/);
      if (match) {
        if (currentList === "ignore") ignoreList.push(match[1].trim());
        else if (currentList === "fallback") fallbackList.push(match[1].trim());
        continue;
      }
      currentList = null;
    }

    const kv = line.match(/^(\w+)\s*:\s*(.+)/);
    if (!kv) {
      if (line.match(/^(\w+)\s*:/)) {
        const key = line.match(/^(\w+)/)?.[1];
        if (key === "ignore") currentList = "ignore";
        else if (key === "fallback") currentList = "fallback";
      }
      continue;
    }
    const [, key, val] = kv;
    const v = val.trim();

    switch (key) {
      case "provider": config.provider = v; break;
      case "model": config.model = v; break;
      case "threshold": config.confidenceThreshold = parseFloat(v); break;
      case "verify": config.verifyCommand = v; break;
      case "maxInputTokens": config.maxInputTokens = parseInt(v, 10); break;
      case "maxOutputTokens": config.maxOutputTokens = parseInt(v, 10); break;
      case "triage": break;
    }
  }

  if (ignoreList.length > 0) config.ignore = ignoreList;
  if (fallbackList.length > 0) config.fallbackProviders = fallbackList;
  return config;
}
