// FR-04.5/04.7 + FR-05 - Orchestrator: scan -> migrate -> enforce -> gate -> deliver
// Pipeline is UI-agnostic (ARCHITECTURE.md §5: one pipeline, two shells). No argv/TTY here.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { BreakingChangeSpec, Finding, MigrateOptions, MigrationOutcome, specRef } from "./types.js";
import { loadSpec } from "./changefeed/loader.js";
import { loadRepoConfig, DEFAULTS } from "./config.js";
import { scan } from "./scanner/scan.js";
import { triage, actionable } from "./triage/triage.js";
import { buildMigrationPrompt } from "./migrator/prompt.js";
import { runMigrationAgent, runProviderMigration } from "./migrator/agent.js";
import { getProvider, listProviders, buildFallbackChain } from "./providers/registry.js";
import * as git from "./repo/git.js";
import { renderReport } from "./report/report.js";

const sh = promisify(exec);

export async function scanOnly(opts: MigrateOptions): Promise<{ spec: BreakingChangeSpec; outcome: MigrationOutcome }> {
  const repo = resolve(opts.repo);
  const spec = await loadSpec(opts.specPath);
  const cfg = await loadRepoConfig(repo);
  const scanResult = await scan(repo, spec, cfg);
  const outcome: MigrationOutcome = {
    specRef: specRef(spec),
    repo,
    scan: scanResult,
    gated: [],
    violations: [],
    status: scanResult.findings.length === 0 ? "not_affected" : "report_only",
  };
  if (opts.triage && scanResult.findings.length > 0) {
    const t = await triage(repo, spec, scanResult.findings);
    outcome.triage = { verdicts: t.findings, usage: t.usage, degraded: t.degraded };
    if (actionable(t.findings).length === 0) outcome.status = "not_affected";
  }
  return { spec, outcome };
}

export async function migrate(opts: MigrateOptions): Promise<{ spec: BreakingChangeSpec; outcome: MigrationOutcome }> {
  const repo = resolve(opts.repo);
  const spec = await loadSpec(opts.specPath);
  const cfg = await loadRepoConfig(repo);
  const threshold = opts.threshold ?? cfg.confidenceThreshold ?? DEFAULTS.confidenceThreshold;
  const model = opts.model ?? cfg.model ?? DEFAULTS.model;

  const outcome: MigrationOutcome = {
    specRef: specRef(spec),
    repo,
    scan: undefined as any,
    gated: [],
    violations: [],
    status: "failed",
  };

  // FR-02.2 - git safety protocol
  const inGit = await git.isGitRepo(repo);
  if (!inGit && !opts.noGit) {
    throw new GitSafetyError(`${repo} is not a git repository. Re-run with --no-git to acknowledge in-place edits without branch isolation.`);
  }
  if (inGit && !(await git.isCleanTree(repo)) && !opts.allowDirty) {
    throw new GitSafetyError(`Working tree has uncommitted changes. Commit/stash them, or re-run with --allow-dirty.`);
  }

  // FR-03.1 - scan
  outcome.scan = await scan(repo, spec, cfg);
  if (outcome.scan.findings.length === 0) {
    outcome.status = "not_affected";
    return { spec, outcome };
  }

  // FR-03.2 - triage narrows the work list (conservative: uncertain stays in)
  let workList: Finding[] = outcome.scan.findings;
  if (opts.triage) {
    const t = await triage(repo, spec, workList);
    outcome.triage = { verdicts: t.findings, usage: t.usage, degraded: t.degraded };
    workList = actionable(t.findings);
    if (workList.length === 0) {
      outcome.status = "not_affected";
      return { spec, outcome };
    }
  }

  const prompt = buildMigrationPrompt(spec, workList);
  if (opts.dryRun) {
    outcome.status = "report_only";
    outcome.manifest = undefined;
    (outcome as any).promptPreview = prompt;
    return { spec, outcome };
  }

  // FR-05.1 - branch isolation
  let originalBranch: string | undefined;
  if (inGit) {
    originalBranch = await git.currentBranch(repo);
    outcome.branch = await git.createMigrationBranch(repo, spec.vendor, spec.version);
  }

  try {
    // FR-04 - agent run (Agent SDK for Anthropic, provider-agnostic loop for others)
    const providerId = opts.provider ?? cfg.provider;
    const useProviderLoop = providerId && providerId !== "anthropic";
    const resolvedModel = useProviderLoop && !opts.model && !cfg.model
      ? (listProviders().find((p) => p.id === providerId)?.defaultModel ?? model)
      : model;

    // Build provider with fallback chain if configured
    const fallbackIds = opts.fallbackProviders ?? cfg.fallbackProviders ?? [];
    let provider;
    if (useProviderLoop && providerId) {
      if (fallbackIds.length > 0) {
        provider = buildFallbackChain([providerId, ...fallbackIds]);
      } else {
        provider = getProvider(providerId);
      }
    }

    const tokenOpts = {
      maxInputTokens: opts.maxInputTokens ?? cfg.maxInputTokens,
      maxOutputTokens: opts.maxOutputTokens ?? cfg.maxOutputTokens,
    };

    const run = useProviderLoop && provider
      ? await runProviderMigration(repo, prompt, provider, resolvedModel, tokenOpts)
      : await runMigrationAgent(repo, prompt, { model, ...tokenOpts });
    outcome.usage = run.usage;

    if (!run.manifest) {
      // FR-04.7 - manifest-or-revert
      await persistFailure(repo, run.manifestProblems, run.finalText);
      if (inGit) await git.hardRestore(repo);
      outcome.status = "failed";
      outcome.violations = run.manifestProblems;
      return { spec, outcome };
    }
    outcome.manifest = run.manifest;

    if (inGit) {
      // FR-04.7 - scope enforcement: revert files the agent touched outside work list + manifest
      const touched = (await git.changedFiles(repo)).filter((p) => !p.startsWith(".evergreen"));
      const allowed = new Set<string>([
        ...outcome.scan.findings.map((f) => f.file),
        ...run.manifest.files.map((f) => f.path),
      ]);
      const outOfScope = touched.filter((p) => !allowed.has(p));
      if (outOfScope.length > 0) {
        await git.restoreFiles(repo, outOfScope);
        outcome.violations.push(...outOfScope.map((p) => `out-of-scope edit reverted: ${p}`));
      }

      // FR-04.5 - confidence gate
      const gatedFiles = run.manifest.files.filter((f) => f.status === "migrated" && f.confidence < threshold);
      if (gatedFiles.length > 0) {
        await git.restoreFiles(repo, gatedFiles.map((f) => f.path));
        outcome.gated = gatedFiles.map((f) => ({ path: f.path, confidence: f.confidence }));
      }
    }

    // FR-04.6 - verification hook
    if (opts.verify && cfg.verifyCommand) {
      try {
        const { stdout, stderr } = await sh(cfg.verifyCommand, { cwd: repo, timeout: 10 * 60 * 1000 });
        outcome.verify = { command: cfg.verifyCommand, exitCode: 0, tail: tail(stdout + stderr) };
      } catch (e: any) {
        outcome.verify = { command: cfg.verifyCommand, exitCode: e.code ?? 1, tail: tail((e.stdout ?? "") + (e.stderr ?? "")) };
        for (const f of outcome.manifest.files) f.confidence = Math.min(f.confidence, 0.5);
      }
    }

    const migratedCount = outcome.manifest.files.filter((f) => f.status === "migrated").length - outcome.gated.length;
    outcome.status = migratedCount > 0 ? "migrated" : "report_only";

    // FR-05.2 - report, committed on the branch
    const report = renderReport(outcome, spec);
    await mkdir(join(repo, ".evergreen"), { recursive: true });
    await writeFile(join(repo, ".evergreen", "MIGRATION_REPORT.md"), report, "utf8");

    // FR-05.1 - single commit, back to original branch
    if (inGit && outcome.branch) {
      const msg = `migrate(${spec.vendor}): ${spec.version} - ${migratedCount} file(s)\n\nSpec: ${outcome.specRef}\nGenerated by Evergreen. Review before merging; never auto-merged.`;
      await git.commitAll(repo, msg);
      if (originalBranch) await git.checkout(repo, originalBranch);
    }
    return { spec, outcome };
  } catch (e) {
    // FR-04.7 - restore on failure
    if (inGit) {
      try {
        await git.hardRestore(repo);
        if (originalBranch) {
          await git.checkout(repo, originalBranch);
          if (outcome.branch) await git.deleteBranch(repo, outcome.branch);
          outcome.branch = undefined;
        }
      } catch {
        /* leave what we can for forensics */
      }
    }
    throw e;
  }
}

async function persistFailure(repo: string, problems: string[], finalText: string): Promise<void> {
  await mkdir(join(repo, ".evergreen"), { recursive: true });
  const path = join(repo, ".evergreen", `failed-${Date.now()}.json`);
  await writeFile(path, JSON.stringify({ problems, finalText }, null, 2), "utf8");
}

function tail(s: string, lines = 30): string {
  const arr = s.trim().split(/\r?\n/);
  return arr.slice(-lines).join("\n");
}

export class GitSafetyError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "GitSafetyError";
  }
}
