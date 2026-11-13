// FR-02 - Repo targeting & git safety protocol (FSD.md FR-02.2)
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, ...args], { maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

export async function isGitRepo(repo: string): Promise<boolean> {
  try {
    await git(repo, ["rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/** Clean apart from Evergreen's own artifacts (.evergreen/), which never block a run. */
export async function isCleanTree(repo: string): Promise<boolean> {
  const entries = await statusEntries(repo);
  return entries.every((e) => e.path.startsWith(".evergreen"));
}

export async function currentBranch(repo: string): Promise<string> {
  return git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

/** Create and check out a unique migration branch: evergreen/<vendor>-<version>[-N] */
export async function createMigrationBranch(repo: string, vendor: string, version: string): Promise<string> {
  const base = `evergreen/${vendor}-${version}`.replace(/[^a-zA-Z0-9/_.-]/g, "-");
  let name = base;
  for (let i = 2; ; i++) {
    try {
      await git(repo, ["rev-parse", "--verify", `refs/heads/${name}`]);
      name = `${base}-${i}`; // exists, try next suffix
    } catch {
      break; // does not exist - usable
    }
  }
  await git(repo, ["checkout", "-b", name]);
  return name;
}

export async function checkout(repo: string, branch: string): Promise<void> {
  await git(repo, ["checkout", branch]);
}

interface StatusEntry {
  status: string; // two-char XY porcelain code ("??" = untracked)
  path: string;
}

/** NUL-separated porcelain parse: immune to trimming, quoting, and rename arrows. */
async function statusEntries(repo: string): Promise<StatusEntry[]> {
  const { stdout } = await run("git", ["-C", repo, "status", "--porcelain", "-z"], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const records = stdout.split("\0").filter((r) => r.length > 0);
  const entries: StatusEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const status = records[i].slice(0, 2);
    entries.push({ status, path: records[i].slice(3) });
    if (status[0] === "R" || status[0] === "C") i++; // next record is the source path of a rename/copy
  }
  return entries;
}

/** Paths (repo-relative, posix) with any uncommitted change on the current branch. */
export async function changedFiles(repo: string): Promise<string[]> {
  return (await statusEntries(repo)).map((e) => e.path);
}

/** Revert specific files to HEAD (used by confidence gate + scope enforcement). */
export async function restoreFiles(repo: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const entries = await statusEntries(repo);
  const byPath = new Map(entries.map((e) => [e.path, e.status]));
  const tracked = paths.filter((p) => byPath.has(p) && byPath.get(p) !== "??");
  const untracked = paths.filter((p) => byPath.get(p) === "??");
  if (tracked.length > 0) await git(repo, ["checkout", "HEAD", "--", ...tracked]);
  if (untracked.length > 0) await git(repo, ["clean", "-f", "--", ...untracked]);
}

/** Discard ALL uncommitted changes (restore-on-failure path, FR-04.7 - branch is ours). */
export async function hardRestore(repo: string): Promise<void> {
  await git(repo, ["checkout", "--", "."]);
  await git(repo, ["clean", "-fd", "--exclude=.evergreen"]);
}

export async function commitAll(repo: string, message: string): Promise<string> {
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

export async function deleteBranch(repo: string, branch: string): Promise<void> {
  await git(repo, ["branch", "-D", branch]);
}
