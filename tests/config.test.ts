// Tests for FR-07.2 — Repo config loader (.evergreen.json + .evergreen.yaml)
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { loadRepoConfig, parseYamlConfig } from "../src/config.js";

describe("loadRepoConfig", () => {
  it("returns empty config when no config file exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evergreen-cfg-test-"));
    const cfg = await loadRepoConfig(dir);
    expect(cfg).toEqual({});
    await rm(dir, { recursive: true, force: true });
  });

  it("loads .evergreen.json when present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evergreen-cfg-test-"));
    await writeFile(join(dir, ".evergreen.json"), JSON.stringify({
      provider: "openai",
      model: "gpt-4o",
      confidenceThreshold: 0.9,
      verifyCommand: "pytest",
    }), "utf8");
    const cfg = await loadRepoConfig(dir);
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("gpt-4o");
    expect(cfg.confidenceThreshold).toBe(0.9);
    expect(cfg.verifyCommand).toBe("pytest");
    await rm(dir, { recursive: true, force: true });
  });

  it("falls back to .evergreen.yaml when .json is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evergreen-cfg-test-"));
    await writeFile(join(dir, ".evergreen.yaml"), `
provider: gemini
model: gemini-2.5-pro
threshold: 0.75
verify: npm test
`, "utf8");
    const cfg = await loadRepoConfig(dir);
    expect(cfg.provider).toBe("gemini");
    expect(cfg.model).toBe("gemini-2.5-pro");
    expect(cfg.confidenceThreshold).toBe(0.75);
    expect(cfg.verifyCommand).toBe("npm test");
    await rm(dir, { recursive: true, force: true });
  });

  it("prefers .evergreen.json over .evergreen.yaml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "evergreen-cfg-test-"));
    await writeFile(join(dir, ".evergreen.json"), JSON.stringify({ provider: "anthropic" }), "utf8");
    await writeFile(join(dir, ".evergreen.yaml"), "provider: openai", "utf8");
    const cfg = await loadRepoConfig(dir);
    expect(cfg.provider).toBe("anthropic");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("parseYamlConfig", () => {
  it("parses key-value pairs", () => {
    const cfg = parseYamlConfig("provider: openai\nmodel: gpt-4o\nthreshold: 0.85");
    expect(cfg.provider).toBe("openai");
    expect(cfg.model).toBe("gpt-4o");
    expect(cfg.confidenceThreshold).toBe(0.85);
  });

  it("ignores comments", () => {
    const cfg = parseYamlConfig("# This is a comment\nprovider: anthropic  # inline comment");
    expect(cfg.provider).toBe("anthropic");
  });

  it("parses ignore list", () => {
    const cfg = parseYamlConfig("ignore:\n  - vendor/**\n  - generated/**\nprovider: anthropic");
    expect(cfg.ignore).toEqual(["vendor/**", "generated/**"]);
    expect(cfg.provider).toBe("anthropic");
  });

  it("returns empty config for empty/comment-only content", () => {
    const cfg = parseYamlConfig("# just comments\n\n# another");
    expect(cfg).toEqual({});
  });
});
