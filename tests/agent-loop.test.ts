// Integration test: full agent loop with mock provider exercising Read/Edit/Write tools
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAgentLoop } from "../src/providers/agent-loop.js";
import { MockProvider, createMigrationMockScript } from "./mock-provider.js";

describe("Agent loop integration (mock provider)", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "evergreen-agent-test-"));
    await mkdir(join(repoDir, "src"), { recursive: true });
    await writeFile(
      join(repoDir, "src/billing.ts"),
      'const charge = await stripe.charges.create({ amount: 1000 });\n',
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("executes Read → Edit → Write manifest flow", async () => {
    const manifest = JSON.stringify({
      specRef: "stripe@2025-03-31",
      engine: { model: "mock-v1" },
      files: [{
        path: "src/billing.ts",
        rules: ["STRIPE-001"],
        status: "migrated",
        confidence: 0.9,
        summary: "Replaced charges.create with paymentIntents.create",
      }],
    });

    const provider = new MockProvider(createMigrationMockScript(manifest));
    const result = await runAgentLoop(
      provider,
      "You are a migration engine.",
      "Migrate the code.",
      repoDir,
      "mock-v1",
    );

    // The file should be edited
    const edited = await readFile(join(repoDir, "src/billing.ts"), "utf8");
    expect(edited).toContain("paymentIntents.create");
    expect(edited).not.toContain("charges.create");

    // The manifest should be written
    const manifestFile = await readFile(join(repoDir, ".evergreen/manifest.json"), "utf8");
    const parsed = JSON.parse(manifestFile);
    expect(parsed.specRef).toBe("stripe@2025-03-31");
    expect(parsed.files[0].status).toBe("migrated");

    // Usage should be accumulated
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.turns).toBe(4);
    expect(result.finalText).toContain("Migration complete");
  });

  it("accumulates token usage across turns", async () => {
    const manifest = JSON.stringify({
      specRef: "test@1.0",
      engine: { model: "mock-v1" },
      files: [],
    });
    const provider = new MockProvider(createMigrationMockScript(manifest));
    const result = await runAgentLoop(provider, "System.", "User.", repoDir, "mock-v1");

    // 4 turns, each with 100 input + 50 output
    expect(result.usage.inputTokens).toBe(400);
    expect(result.usage.outputTokens).toBe(200);
  });

  it("respects maxTurns limit", async () => {
    // Create a provider that always makes tool calls (infinite loop)
    const infiniteScript = Array(100).fill({
      type: "tool_calls" as const,
      calls: [{ id: "call_n", name: "Read", arguments: { path: "src/billing.ts" } }],
    });
    const provider = new MockProvider(infiniteScript);

    const result = await runAgentLoop(provider, "System.", "User.", repoDir, "mock-v1", {
      maxTurns: 5,
    });

    expect(result.turns).toBe(5);
  });

  it("handles tool errors gracefully", async () => {
    const provider = new MockProvider([
      {
        type: "tool_calls",
        calls: [{ id: "call_err", name: "Read", arguments: { path: "nonexistent/file.ts" } }],
      },
      { type: "text", content: "File not found, skipping." },
    ]);

    const result = await runAgentLoop(provider, "System.", "User.", repoDir, "mock-v1");
    expect(result.turns).toBe(2);
    expect(result.finalText).toContain("File not found");
  });

  it("blocks path traversal in tools", async () => {
    const provider = new MockProvider([
      {
        type: "tool_calls",
        calls: [{ id: "call_escape", name: "Read", arguments: { path: "../../etc/passwd" } }],
      },
      { type: "text", content: "Blocked." },
    ]);

    const result = await runAgentLoop(provider, "System.", "User.", repoDir, "mock-v1");
    expect(result.turns).toBe(2);
  });
});
