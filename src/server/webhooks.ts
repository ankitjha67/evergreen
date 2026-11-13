// FR-08.2/08.4 — GitHub webhook event handlers
import { Octokit } from "@octokit/rest";
import { BreakingChangeSpec, ScanResult } from "../types.js";
import { SpecRegistry } from "../registry/specs.js";
import { scan } from "../scanner/scan.js";
import { shallowClone } from "../github/clone.js";
import { getInstallationToken, getInstallationOctokit } from "../github/client.js";
import { createCheckRun, createFailedCheckRun } from "../github/checks.js";

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
