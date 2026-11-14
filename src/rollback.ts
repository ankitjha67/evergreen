// Migration rollback - undo a migration by reverting the evergreen branch
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { join } from "node:path";

const run = promisify(execFile);

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, ...args], { maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

export interface RollbackTarget {
  branch: string;
  commitCount: number;
  lastCommitMessage: string;
  lastCommitHash: string;
}

export interface RollbackResult {
  branch: string;
  action: "deleted" | "reverted" | "not_found";
  previousBranch: string;
  message: string;
}

export async function listMigrationBranches(repo: string): Promise<RollbackTarget[]> {
  let raw: string;
  try {
    raw = await git(repo, ["branch", "--list", "evergreen/*", "--format=%(refname:short)"]);
  } catch {
    return [];
  }

  if (!raw) return [];
  const branches = raw.split("\n").filter(Boolean);
  const targets: RollbackTarget[] = [];

  for (const branch of branches) {
    try {
      const log = await git(repo, ["log", branch, "--oneline", "-1", "--format=%H %s"]);
      const [hash, ...msgParts] = log.split(" ");
      const message = msgParts.join(" ");

      let commitCount = 0;
      try {
        const countRaw = await git(repo, ["rev-list", "--count", `main..${branch}`]);
        commitCount = parseInt(countRaw, 10);
      } catch {
        try {
          const countRaw = await git(repo, ["rev-list", "--count", `master..${branch}`]);
          commitCount = parseInt(countRaw, 10);
        } catch {
          commitCount = 1;
        }
      }

      targets.push({
        branch,
        commitCount,
        lastCommitMessage: message,
        lastCommitHash: hash,
      });
    } catch {
      targets.push({ branch, commitCount: 0, lastCommitMessage: "(unable to read)", lastCommitHash: "" });
    }
  }

  return targets;
}

export async function rollbackMigration(repo: string, branch: string): Promise<RollbackResult> {
  const currentBranch = await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);

  if (!branch.startsWith("evergreen/")) {
    return { branch, action: "not_found", previousBranch: currentBranch, message: `"${branch}" is not an evergreen migration branch` };
  }

  try {
    await git(repo, ["rev-parse", "--verify", `refs/heads/${branch}`]);
  } catch {
    return { branch, action: "not_found", previousBranch: currentBranch, message: `Branch "${branch}" does not exist` };
  }

  if (currentBranch === branch) {
    const mainBranch = await detectMainBranch(repo);
    await git(repo, ["checkout", mainBranch]);
  }

  await git(repo, ["branch", "-D", branch]);

  return {
    branch,
    action: "deleted",
    previousBranch: currentBranch,
    message: `Deleted migration branch "${branch}". Migration rolled back.`,
  };
}

async function detectMainBranch(repo: string): Promise<string> {
  try {
    await git(repo, ["rev-parse", "--verify", "refs/heads/main"]);
    return "main";
  } catch {
    try {
      await git(repo, ["rev-parse", "--verify", "refs/heads/master"]);
      return "master";
    } catch {
      const current = await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
      return current;
    }
  }
}

export function formatRollbackTargets(targets: RollbackTarget[]): string {
  if (targets.length === 0) return "No migration branches found.";

  const lines: string[] = [
    `Migration Branches (${targets.length}):`,
    "─".repeat(60),
  ];

  for (const t of targets) {
    lines.push(`  ${t.branch}`);
    lines.push(`    ${t.commitCount} commit(s) | ${t.lastCommitHash.slice(0, 8)} | ${t.lastCommitMessage.slice(0, 60)}`);
  }

  lines.push("");
  lines.push("To rollback: evergreen rollback <branch-name>");

  return lines.join("\n");
}
