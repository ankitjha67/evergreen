import { describe, it, expect } from "vitest";
import { resolve, join } from "node:path";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { loadManifest, batchScan } from "../src/batch.js";

const SPECS_DIR = resolve("specs");
const FIXTURES = resolve("fixtures");
const TMP = resolve("test-tmp-batch");

describe("loadManifest", () => {
  it("loads JSON array manifest", async () => {
    await mkdir(TMP, { recursive: true });
    const p = join(TMP, "repos.json");
    await writeFile(p, JSON.stringify(["./repo-a", "./repo-b"]), "utf8");
    const m = await loadManifest(p);
    expect(m.repos).toEqual(["./repo-a", "./repo-b"]);
    await rm(TMP, { recursive: true, force: true });
  });

  it("loads JSON object manifest", async () => {
    await mkdir(TMP, { recursive: true });
    const p = join(TMP, "repos.json");
    await writeFile(p, JSON.stringify({ repos: ["./a"] }), "utf8");
    const m = await loadManifest(p);
    expect(m.repos).toEqual(["./a"]);
    await rm(TMP, { recursive: true, force: true });
  });

  it("loads plain text manifest", async () => {
    await mkdir(TMP, { recursive: true });
    const p = join(TMP, "repos.txt");
    await writeFile(p, "# comment\n./repo-a\n./repo-b\n\n", "utf8");
    const m = await loadManifest(p);
    expect(m.repos).toEqual(["./repo-a", "./repo-b"]);
    await rm(TMP, { recursive: true, force: true });
  });

  it("rejects empty manifest", async () => {
    await mkdir(TMP, { recursive: true });
    const p = join(TMP, "empty.txt");
    await writeFile(p, "# only comments\n\n", "utf8");
    await expect(loadManifest(p)).rejects.toThrow("empty");
    await rm(TMP, { recursive: true, force: true });
  });
});

describe("batchScan", () => {
  it("scans multiple fixture repos", async () => {
    const manifest = {
      repos: [
        join(FIXTURES, "demo-repo"),
        join(FIXTURES, "demo-repo-python"),
      ],
    };
    const result = await batchScan(manifest, SPECS_DIR, {});

    expect(result.totalRepos).toBe(2);
    expect(result.totalSpecs).toBeGreaterThan(0);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.reposAffected).toBeGreaterThanOrEqual(1);
    expect(result.totalFindings).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("handles non-existent repos gracefully", async () => {
    const manifest = { repos: [join(FIXTURES, "nonexistent-repo")] };
    const result = await batchScan(manifest, SPECS_DIR, {});
    expect(result.totalRepos).toBe(1);
    expect(result.results.every((r) => r.findings === 0)).toBe(true);
  });

  it("filters by language", async () => {
    const manifest = { repos: [join(FIXTURES, "demo-repo")] };
    const result = await batchScan(manifest, SPECS_DIR, { lang: "javascript" });

    const jsResults = result.results.filter((r) => !r.error);
    expect(jsResults.length).toBeGreaterThan(0);
    expect(result.totalFindings).toBeGreaterThan(0);
  });
});
