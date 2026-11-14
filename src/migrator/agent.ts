// FR-04.1 - Migration agent: Claude Agent SDK session, cwd-jailed, no bash/network
// (FSD.md FR-04, SYSTEM_DESIGN.md §6.1)
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { ChangeManifest, TokenUsage } from "../types.js";
import { DEFAULTS } from "../config.js";
import { MANIFEST_RELPATH } from "./prompt.js";

export interface AgentRunResult {
  manifest?: ChangeManifest;
  manifestProblems: string[];
  usage: TokenUsage;
  finalText: string;
}

/** Single Agent SDK session; also used by triage with no tools (FR-03.2 engine, SYSTEM_DESIGN §2). */
export async function runAgentSession(
  repo: string,
  prompt: string,
  opts: { model?: string; maxTurns?: number; allowedTools?: string[] } = {},
): Promise<{ usage: TokenUsage; finalText: string }> {
  const model = opts.model ?? DEFAULTS.model;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let outputTokens = 0;
  let finalText = "";

  const session = query({
    prompt,
    options: {
      cwd: repo,
      model,
      permissionMode: "acceptEdits",
      allowedTools: opts.allowedTools ?? ["Read", "Edit", "Write", "Grep", "Glob"], // FR-04.1: no Bash, no network
      maxTurns: opts.maxTurns ?? DEFAULTS.agentMaxTurns,
    },
  });

  const take = (u: any, assign: boolean) => {
    if (!u) return;
    const add = (cur: number, v: number) => (assign ? v : cur + v);
    inputTokens = add(inputTokens, u.input_tokens ?? 0);
    cacheReadTokens = add(cacheReadTokens, u.cache_read_input_tokens ?? 0);
    cacheCreationTokens = add(cacheCreationTokens, u.cache_creation_input_tokens ?? 0);
    outputTokens = add(outputTokens, u.output_tokens ?? 0);
  };

  for await (const message of session) {
    const m = message as any;
    if (m.type === "assistant" && m.message?.usage) take(m.message.usage, false);
    if (m.type === "result") {
      finalText = m.result ?? "";
      if (m.usage) take(m.usage, true); // result usage is authoritative totals
    }
  }

  const p = DEFAULTS.pricing;
  const costUSD =
    (inputTokens / 1e6) * p.inputPerMTok +
    (cacheReadTokens / 1e6) * p.cacheReadPerMTok +
    (cacheCreationTokens / 1e6) * p.cacheCreationPerMTok +
    (outputTokens / 1e6) * p.outputPerMTok;

  return {
    usage: { inputTokens, cacheReadTokens, cacheCreationTokens, outputTokens, costUSD: Number(costUSD.toFixed(4)) },
    finalText,
  };
}

export async function runMigrationAgent(
  repo: string,
  prompt: string,
  opts: { model?: string; maxTurns?: number } = {},
): Promise<AgentRunResult> {
  const { usage, finalText } = await runAgentSession(repo, prompt, opts);
  const { manifest, problems } = await readManifest(repo);
  return { manifest, manifestProblems: problems, usage, finalText };
}

/** FR-09 - Run migration via the provider-agnostic agent loop (non-Anthropic providers). */
export async function runProviderMigration(
  repo: string,
  prompt: string,
  provider: import("../providers/types.js").LLMProvider,
  model: string,
  opts: { maxTurns?: number } = {},
): Promise<AgentRunResult> {
  const { runAgentLoop } = await import("../providers/agent-loop.js");
  const systemPrompt = "You are Evergreen's migration engine. Follow the user's instructions exactly.";
  const { usage, finalText } = await runAgentLoop(provider, systemPrompt, prompt, repo, model, {
    maxTurns: opts.maxTurns,
  });
  const { manifest, problems } = await readManifest(repo);
  return { manifest, manifestProblems: problems, usage, finalText };
}

// FR-04.4 - manifest validation: missing/invalid manifest => failed run
async function readManifest(repo: string): Promise<{ manifest?: ChangeManifest; problems: string[] }> {
  const problems: string[] = [];
  let raw: string;
  try {
    raw = await readFile(join(repo, MANIFEST_RELPATH), "utf8");
  } catch {
    return { problems: [`manifest missing at ${MANIFEST_RELPATH}`] };
  }
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { problems: [`manifest is not valid JSON: ${(e as Error).message}`] };
  }
  if (typeof data.specRef !== "string") problems.push("manifest.specRef missing");
  if (!Array.isArray(data.files)) problems.push("manifest.files must be an array");
  else {
    data.files.forEach((f: any, i: number) => {
      if (typeof f.path !== "string") problems.push(`files[${i}].path missing`);
      if (!["migrated", "skipped", "partial"].includes(f.status)) problems.push(`files[${i}].status invalid`);
      if (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1)
        problems.push(`files[${i}].confidence must be 0..1`);
      if (typeof f.summary !== "string") problems.push(`files[${i}].summary missing`);
    });
  }
  return problems.length > 0 ? { problems } : { manifest: data as ChangeManifest, problems: [] };
}
