// FR-08.3 — Shallow clone via installation token + cleanup
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface CloneResult {
  dir: string;
  cleanup: () => Promise<void>;
}

export async function shallowClone(
  owner: string,
  repo: string,
  ref: string,
  token: string,
): Promise<CloneResult> {
  const dir = await mkdtemp(join(tmpdir(), `evergreen-scan-`));
  const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  try {
    await run("git", ["clone", "--depth", "1", "--branch", ref, "--single-branch", url, dir], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (e: any) {
    // ref might be a SHA not a branch — try fetch-based approach
    await run("git", ["clone", "--depth", "1", url, dir], {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    await run("git", ["-C", dir, "checkout", ref], { timeout: 30_000 });
  }
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export async function shallowCloneDefault(
  owner: string,
  repo: string,
  token: string,
): Promise<CloneResult> {
  const dir = await mkdtemp(join(tmpdir(), `evergreen-scan-`));
  const url = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  await run("git", ["clone", "--depth", "1", url, dir], {
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
