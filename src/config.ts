// FR-07.2 — Repo config (.evergreen.json) + precedence: CLI flag > repo config > defaults
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
  try {
    const raw = await readFile(join(repo, ".evergreen.json"), "utf8");
    const cfg = JSON.parse(raw) as RepoConfig;
    if (cfg.confidenceThreshold !== undefined && (cfg.confidenceThreshold < 0 || cfg.confidenceThreshold > 1)) {
      throw new Error(".evergreen.json: confidenceThreshold must be between 0 and 1");
    }
    return cfg;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}
