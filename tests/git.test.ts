// FR-02 - git safety protocol (integration on temp repos)
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as g from "../src/repo/git.js";

const run = promisify(execFile);

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "eg-git-"));
  const git = (...args: string[]) => run("git", ["-C", repo, ...args]);
  await git("init", "-b", "main");
  await git("config", "core.longpaths", "true");
  await git("config", "user.email", "test@evergreen.local");
  await git("config", "user.name", "Evergreen Test");
  await writeFile(join(repo, "a.js"), "const a = 1;\n");
  await mkdir(join(repo, "src"));
  await writeFile(join(repo, "src", "b.js"), "const b = 2;\n");
  await git("add", "-A");
  await git("commit", "-m", "baseline");
  return repo;
}

describe("FR-02 git safety", () => {
  let repo: string;
  beforeEach(async () => {
    repo = await makeRepo();
  });

  it("isCleanTree: true on fresh repo, ignores .evergreen artifacts, false on real changes", async () => {
    expect(await g.isCleanTree(repo)).toBe(true);
    await mkdir(join(repo, ".evergreen"));
    await writeFile(join(repo, ".evergreen", "failed-1.json"), "{}");
    expect(await g.isCleanTree(repo)).toBe(true); // forensics never block (v1.1)
    await writeFile(join(repo, "a.js"), "const a = 99;\n");
    expect(await g.isCleanTree(repo)).toBe(false);
  });

  it("createMigrationBranch: unique suffixing, and checkout returns", async () => {
    const b1 = await g.createMigrationBranch(repo, "stripe", "2025-03-31.basil");
    expect(b1).toBe("evergreen/stripe-2025-03-31.basil");
    await g.checkout(repo, "main");
    const b2 = await g.createMigrationBranch(repo, "stripe", "2025-03-31.basil");
    expect(b2).toBe("evergreen/stripe-2025-03-31.basil-2");
    expect(await g.currentBranch(repo)).toBe(b2);
  });

  it("changedFiles: correct paths for modified AND untracked files (porcelain -z parse)", async () => {
    await writeFile(join(repo, "src", "b.js"), "const b = 3;\n"); // modified (first status line!)
    await writeFile(join(repo, "created.js"), "new\n"); // untracked
    const changed = await g.changedFiles(repo);
    expect(changed.sort()).toEqual(["created.js", "src/b.js"]); // regression: trim bug mangled "src/" -> "rc/"
  });

  it("restoreFiles: reverts tracked edits and removes untracked files", async () => {
    await writeFile(join(repo, "src", "b.js"), "const b = 3;\n");
    await writeFile(join(repo, "created.js"), "new\n");
    await g.restoreFiles(repo, ["src/b.js", "created.js"]);
    expect(await g.isCleanTree(repo)).toBe(true);
  });

  it("commitAll + hardRestore leave a usable repo", async () => {
    await writeFile(join(repo, "a.js"), "const a = 42;\n");
    const sha = await g.commitAll(repo, "test commit");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    await writeFile(join(repo, "a.js"), "const a = 777;\n");
    await g.hardRestore(repo);
    expect(await g.isCleanTree(repo)).toBe(true);
  });
});
