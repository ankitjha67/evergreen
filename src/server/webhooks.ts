// FR-08.2/08.4/10 - GitHub webhook event handlers + auto-migrate
import { Octokit } from "@octokit/rest";
import { BreakingChangeSpec, ScanResult, specRef } from "../types.js";
import { SpecRegistry } from "../registry/specs.js";
import { scan } from "../scanner/scan.js";
import { shallowClone } from "../github/clone.js";
import { getInstallationToken, getInstallationOctokit } from "../github/client.js";
import { createCheckRun, createFailedCheckRun } from "../github/checks.js";
import { createMigrationPR } from "../github/pr.js";
import { buildMigrationPrompt } from "../migrator/prompt.js";
import { runAgentLoop } from "../providers/agent-loop.js";
import { resolveProvider } from "../providers/registry.js";
import { logUsage } from "../usage.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface WebhookContext {
  appOctokit: Octokit;
  registry: SpecRegistry;
  log: (level: string, msg: string, meta?: Record<string, unknown>) => void;
}

interface RepoRef {
  owner: string;
  repo: string;
  sha: string;
  ref: string;
  installationId: number;
}

export async function handlePush(ctx: WebhookContext, payload: any): Promise<void> {
  const installationId = payload.installation?.id;
  if (!installationId) {
    ctx.log("warn", "Push event without installation ID, skipping");
    return;
  }

  const ref: RepoRef = {
    owner: payload.repository.owner.login ?? payload.repository.owner.name,
    repo: payload.repository.name,
    sha: payload.after,
    ref: payload.ref.replace("refs/heads/", ""),
    installationId,
  };

  // Only scan pushes to the default branch
  const defaultBranch = payload.repository.default_branch;
  if (ref.ref !== defaultBranch) {
    ctx.log("debug", `Skipping push to non-default branch ${ref.ref}`);
    return;
  }

  await scanRepo(ctx, ref);
}

export async function handlePullRequest(ctx: WebhookContext, payload: any): Promise<void> {
  const installationId = payload.installation?.id;
  if (!installationId) {
    ctx.log("warn", "PR event without installation ID, skipping");
    return;
  }

  const action = payload.action;
  if (!["opened", "synchronize", "reopened"].includes(action)) {
    ctx.log("debug", `Skipping PR action: ${action}`);
    return;
  }

  const ref: RepoRef = {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    sha: payload.pull_request.head.sha,
    ref: payload.pull_request.head.ref,
    installationId,
  };

  await scanRepo(ctx, ref);
}

export async function handleInstallation(ctx: WebhookContext, payload: any): Promise<void> {
  const action = payload.action;
  const account = payload.installation.account.login;
  const repos = payload.repositories?.map((r: any) => r.full_name) ?? [];

  if (action === "created") {
    ctx.log("info", `App installed on ${account}`, { repos });
  } else if (action === "deleted") {
    ctx.log("info", `App uninstalled from ${account}`);
  }
}

async function scanRepo(ctx: WebhookContext, ref: RepoRef): Promise<void> {
  const { owner, repo, sha, installationId } = ref;
  const fullName = `${owner}/${repo}`;
  ctx.log("info", `Scanning ${fullName}@${sha.slice(0, 7)}`, { ref: ref.ref });

  let token: string;
  let octokit: Octokit;
  try {
    token = await getInstallationToken(ctx.appOctokit, installationId);
    octokit = await getInstallationOctokit(ctx.appOctokit, installationId);
  } catch (e: any) {
    ctx.log("error", `Failed to get installation token for ${fullName}: ${e.message}`);
    return;
  }

  let cloneDir: string | undefined;
  let cleanup: (() => Promise<void>) | undefined;

  try {
    const result = await shallowClone(owner, repo, ref.ref, token);
    cloneDir = result.dir;
    cleanup = result.cleanup;
  } catch (e: any) {
    ctx.log("error", `Clone failed for ${fullName}: ${e.message}`);
    try {
      await createFailedCheckRun(octokit, owner, repo, sha, `Clone failed: ${e.message}`);
    } catch {
      ctx.log("error", `Failed to post error Check Run for ${fullName}`);
    }
    return;
  }

  try {
    const specs = ctx.registry.allSpecs();
    let anyFindings = false;

    for (const spec of specs) {
      try {
        const scanResult: ScanResult = await scan(cloneDir, spec, {});
        if (scanResult.findings.length > 0) {
          anyFindings = true;
          ctx.log("info", `Found ${scanResult.findings.length} findings for ${spec.title} in ${fullName}`);
          await createCheckRun(octokit, owner, repo, sha, spec, scanResult);
        }
      } catch (e: any) {
        ctx.log("error", `Scan error for spec ${spec.title} on ${fullName}: ${e.message}`);
      }
    }

    if (!anyFindings) {
      ctx.log("debug", `No findings in ${fullName} for any spec`);
    }

    // FR-10 - Auto-migrate: if enabled and findings exist, run migration and open PR
    if (anyFindings && process.env.AUTO_MIGRATE === "true") {
      for (const spec of specs) {
        const scanResult: ScanResult = await scan(cloneDir, spec, {});
        if (scanResult.findings.length === 0) continue;

        ctx.log("info", `Auto-migrating ${fullName} for ${spec.title}`);
        try {
          await autoMigrate(ctx, octokit, owner, repo, ref.ref, sha, cloneDir, token, spec, scanResult);
        } catch (e: any) {
          ctx.log("error", `Auto-migrate failed for ${spec.title} on ${fullName}: ${e.message}`);
        }
      }
    }
  } finally {
    if (cleanup) {
      try {
        await cleanup();
      } catch {
        ctx.log("warn", `Failed to clean up temp dir for ${fullName}`);
      }
    }
  }
}

// FR-10 - Auto-migrate + PR creation
async function autoMigrate(
  ctx: WebhookContext,
  octokit: Octokit,
  owner: string,
  repo: string,
  baseBranch: string,
  sha: string,
  cloneDir: string,
  token: string,
  spec: BreakingChangeSpec,
  scanResult: ScanResult,
): Promise<void> {
  const fullName = `${owner}/${repo}`;
  const startMs = Date.now();

  // Update Check Run to in_progress
  const { data: checkRun } = await octokit.checks.create({
    owner,
    repo,
    name: `Evergreen Migration: ${spec.title}`,
    head_sha: sha,
    status: "in_progress",
    output: { title: "Migration in progress", summary: `Running auto-migration for ${spec.title}...` },
  });

  const provider = resolveProvider({});
  const prompt = buildMigrationPrompt(spec, scanResult.findings);
  const systemPrompt = "You are Evergreen's migration engine. Follow the user's instructions exactly.";

  const result = await runAgentLoop(
    provider,
    systemPrompt,
    prompt,
    cloneDir,
    provider.defaultModel,
  );

  // Read the manifest to verify migration
  let manifest;
  try {
    const raw = await readFile(join(cloneDir, ".evergreen/manifest.json"), "utf8");
    manifest = JSON.parse(raw);
  } catch {
    ctx.log("error", `Migration did not produce a valid manifest for ${fullName}`);
    await octokit.checks.update({
      owner, repo, check_run_id: checkRun.id,
      status: "completed", conclusion: "failure",
      output: { title: "Migration failed", summary: "The migration agent did not produce a valid manifest." },
    });
    return;
  }

  // Push branch and open PR
  const pr = await createMigrationPR(octokit, owner, repo, baseBranch, cloneDir, token, spec, scanResult, manifest);
  ctx.log("info", `Auto-migration PR created: ${pr.prUrl}`);

  // Update Check Run with PR link
  await octokit.checks.update({
    owner, repo, check_run_id: checkRun.id,
    status: "completed", conclusion: "action_required",
    output: {
      title: `Migration PR #${pr.prNumber} opened`,
      summary: `Auto-migration complete. Review and merge [PR #${pr.prNumber}](${pr.prUrl}).\n\n` +
        `Files migrated: ${manifest.files.filter((f: any) => f.status === "migrated").length}\n` +
        `Files skipped: ${manifest.files.filter((f: any) => f.status === "skipped").length}`,
    },
  });

  // FR-10.5 - Log usage
  await logUsage({
    timestamp: new Date().toISOString(),
    event: "auto-pr",
    repo: fullName,
    specRef: specRef(spec),
    provider: provider.id,
    model: provider.defaultModel,
    usage: result.usage,
    findings: scanResult.findings.length,
    filesChanged: manifest.files.filter((f: any) => f.status === "migrated").length,
    prUrl: pr.prUrl,
    durationMs: Date.now() - startMs,
  });
}
