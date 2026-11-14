import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import {
  listMigrationBranches,
  rollbackMigration,
  formatRollbackTargets,
  type RollbackTarget,
} from "../src/rollback.js";

const run = promisify(execFile);

const dirs: string[] = [];

function freshDir(): string {
  const d = join(tmpdir(), `evergreen-test-${randomUUID()}`);
  dirs.push(d);
  return d;
}

afterEach(async () => {
  for (const d of dirs.splice(0)) {
    try { await rm(d, { recursive: true, force: true }); } catch {}
  }
});

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", repo, ...args]);
  return stdout.trim();
}

async function setupGitRepo(): Promise<string> {
  const repo = freshDir();
  await mkdir(repo, { recursive: true });
  await git(repo, ["init", "-b", "main"]);
  await git(repo, ["config", "user.email", "test@test.com"]);
  await git(repo, ["config", "user.name", "Test"]);
  await writeFile(join(repo, "README.md"), "# Test", "utf8");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-m", "initial"]);
  return repo;
}

describe("listMigrationBranches", () => {
  it("returns empty when no migration branches", async () => {
    const repo = await setupGitRepo();
    const targets = await listMigrationBranches(repo);
    expect(targets).toHaveLength(0);
  });

  it("lists evergreen branches", async () => {
    const repo = await setupGitRepo();
    await git(repo, ["checkout", "-b", "evergreen/stripe-2025-03-31"]);
    await writeFile(join(repo, "test.js"), "updated", "utf8");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "migrate stripe"]);
    await git(repo, ["checkout", "main"]);

    const targets = await listMigrationBranches(repo);
    expect(targets).toHaveLength(1);
    expect(targets[0].branch).toBe("evergreen/stripe-2025-03-31");
    expect(targets[0].lastCommitMessage).toContain("migrate stripe");
    expect(targets[0].commitCount).toBeGreaterThanOrEqual(1);
  });
});

describe("rollbackMigration", () => {
  it("deletes an existing migration branch", async () => {
    const repo = await setupGitRepo();
    await git(repo, ["checkout", "-b", "evergreen/test-rollback"]);
    await writeFile(join(repo, "test.js"), "change", "utf8");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "test migration"]);
    await git(repo, ["checkout", "main"]);

    const result = await rollbackMigration(repo, "evergreen/test-rollback");
    expect(result.action).toBe("deleted");
    expect(result.message).toContain("Deleted");

    const branches = await listMigrationBranches(repo);
    expect(branches).toHaveLength(0);
  });

  it("returns not_found for non-existent branch", async () => {
    const repo = await setupGitRepo();
    const result = await rollbackMigration(repo, "evergreen/nonexistent");
    expect(result.action).toBe("not_found");
    expect(result.message).toContain("does not exist");
  });

  it("rejects non-evergreen branches", async () => {
    const repo = await setupGitRepo();
    const result = await rollbackMigration(repo, "feature/something");
    expect(result.action).toBe("not_found");
    expect(result.message).toContain("not an evergreen");
  });

  it("switches off branch before deleting if currently on it", async () => {
    const repo = await setupGitRepo();
    await git(repo, ["checkout", "-b", "evergreen/current-test"]);
    await writeFile(join(repo, "test.js"), "on branch", "utf8");
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "-m", "on branch"]);

    const result = await rollbackMigration(repo, "evergreen/current-test");
    expect(result.action).toBe("deleted");

    const current = await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(current).toBe("main");
  });
});

describe("formatRollbackTargets", () => {
  it("shows 'no branches' for empty list", () => {
    const formatted = formatRollbackTargets([]);
    expect(formatted).toContain("No migration branches");
  });

  it("formats branches with commit info", () => {
    const targets: RollbackTarget[] = [
      { branch: "evergreen/stripe-2025", commitCount: 2, lastCommitMessage: "migrate stripe", lastCommitHash: "abc12345def" },
    ];
    const formatted = formatRollbackTargets(targets);
    expect(formatted).toContain("evergreen/stripe-2025");
    expect(formatted).toContain("2 commit(s)");
    expect(formatted).toContain("abc12345");
    expect(formatted).toContain("migrate stripe");
  });
});
