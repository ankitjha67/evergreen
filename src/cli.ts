#!/usr/bin/env node
// FR-07 — CLI shell. The ONLY file that reads argv (ARCHITECTURE.md §5).
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { migrate, scanOnly, GitSafetyError } from "./orchestrator.js";
import { renderScanTable } from "./scanner/scan.js";
import { SpecValidationError } from "./types.js";

const program = new Command();
program.name("evergreen").description("Self-maintaining APIs: scan and migrate codebases when API vendors ship breaking changes.").version("0.5.0");

const common = (cmd: Command) =>
  cmd
    .requiredOption("--spec <file>", "changefeed spec (BreakingChangeSpec JSON)")
    .option("--repo <path>", "target repository", process.cwd())
    .option("--json", "machine-readable output", false);

common(program.command("scan").description("Find code affected by a breaking-change spec (read-only)"))
  .option("--triage", "run Haiku triage on findings (FR-03.2)", false)
  .action(async (o) => {
    try {
      const { spec, outcome } = await scanOnly({ repo: o.repo, specPath: o.spec, triage: o.triage, json: o.json });
      if (o.json) {
        console.log(JSON.stringify({ scan: outcome.scan, triage: outcome.triage }, null, 2));
      } else {
        console.log(renderScanTable(outcome.scan, spec));
        if (outcome.triage) printTriage(outcome.triage);
      }
      process.exitCode = 0;
    } catch (e) {
      fail(e);
    }
  });

common(program.command("migrate").description("Scan, then run the migration agent and deliver changes on an evergreen/* branch"))
  .option("--triage", "run Haiku triage to narrow the work list before migrating (FR-03.2)", false)
  .option("--dry-run", "scan + print plan, no edits", false)
  .option("--verify", "run .evergreen.json verifyCommand after migration", false)
  .option("--allow-dirty", "proceed despite uncommitted changes (FR-02.2 override)", false)
  .option("--no-git", "acknowledge non-git target: edits in place")
  .option("--model <id>", "migration model override")
  .option("--provider <id>", "LLM provider (anthropic, openai, gemini, ollama, groq, etc.)")
  .option("--threshold <n>", "confidence gate 0..1", parseFloat)
  .action(async (o) => {
    try {
      const { outcome } = await migrate({
        repo: o.repo,
        specPath: o.spec,
        triage: o.triage,
        dryRun: o.dryRun,
        verify: o.verify,
        allowDirty: o.allowDirty,
        noGit: o.git === false,
        model: o.model,
        provider: o.provider,
        threshold: o.threshold,
        json: o.json,
      });
      if (o.json) {
        console.log(JSON.stringify(outcome, null, 2));
      } else {
        summarize(outcome);
      }
      process.exitCode = outcome.status === "failed" ? 3 : 0;
    } catch (e) {
      fail(e);
    }
  });

program
  .command("report")
  .description("Show the last migration report for a repo")
  .option("--repo <path>", "target repository", process.cwd())
  .action(async (o) => {
    try {
      const p = join(resolve(o.repo), ".evergreen", "MIGRATION_REPORT.md");
      console.log(await readFile(p, "utf8"));
    } catch {
      console.error("No migration report found (.evergreen/MIGRATION_REPORT.md). Run `evergreen migrate` first.");
      process.exitCode = 1;
    }
  });

function printTriage(t: any): void {
  console.log(`\nTriage (claude-haiku-5-5)${t.degraded ? ` — DEGRADED: ${t.degraded}` : ""}`);
  for (const v of t.verdicts) console.log(`  ${String(v.verdict).padEnd(13)} ${v.file}:${v.line} [${v.ruleId}] — ${v.reason}`);
  if (t.usage) console.log(`  triage cost: $${t.usage.costUSD}`);
}

function summarize(outcome: any): void {
  console.log(`\nStatus: ${outcome.status}`);
  if (outcome.triage) printTriage(outcome.triage);
  if (outcome.status === "not_affected") {
    console.log("This repository is not affected by the spec. Nothing to do.");
    return;
  }
  if ((outcome as any).promptPreview) {
    console.log(`\n--- Migration plan (dry run) ---\n`);
    console.log((outcome as any).promptPreview);
    return;
  }
  if (outcome.branch) console.log(`Branch:  ${outcome.branch}`);
  if (outcome.manifest) {
    for (const f of outcome.manifest.files) {
      console.log(`  ${f.status.padEnd(9)} ${f.path}  (confidence ${f.confidence.toFixed(2)}) — ${f.summary}`);
    }
  }
  for (const g of outcome.gated) console.log(`  gated     ${g.path} (confidence ${g.confidence.toFixed(2)} < threshold, reverted)`);
  for (const v of outcome.violations) console.log(`  violation ${v}`);
  if (outcome.verify) console.log(`Verify: ${outcome.verify.command} → exit ${outcome.verify.exitCode}`);
  if (outcome.usage)
    console.log(
      `Cost: $${outcome.usage.costUSD} (in ${outcome.usage.inputTokens.toLocaleString()} / cache-read ${outcome.usage.cacheReadTokens.toLocaleString()} / cache-write ${outcome.usage.cacheCreationTokens.toLocaleString()} / out ${outcome.usage.outputTokens.toLocaleString()})`,
    );
  console.log(`Report: .evergreen/MIGRATION_REPORT.md${outcome.branch ? ` (committed on ${outcome.branch})` : ""}`);
}

program
  .command("serve")
  .description("Start the GitHub App webhook server (FR-08)")
  .option("--port <n>", "listen port", "3000")
  .option("--specs-dir <path>", "directory containing changefeed specs", "specs")
  .action(async (o) => {
    try {
      const { config: dotenvConfig } = await import("dotenv");
      dotenvConfig();
      const { startServer, loadServerConfig } = await import("./server/app.js");
      if (o.specsDir) process.env.SPECS_DIR = resolve(o.specsDir);
      if (o.port) process.env.PORT = o.port;
      const config = loadServerConfig();
      await startServer(config);
    } catch (e: any) {
      console.error(`Server failed to start: ${e.message}`);
      process.exitCode = 1;
    }
  });

program
  .command("usage")
  .description("Show usage statistics (scans, migrations, costs)")
  .option("--json", "machine-readable output", false)
  .option("--limit <n>", "recent events to show", "10")
  .action(async (o) => {
    const { getUsageSummary } = await import("./usage.js");
    const summary = await getUsageSummary(undefined, parseInt(o.limit, 10));
    if (o.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (summary.totalEvents === 0) {
      console.log("\nNo usage data yet. Run `evergreen scan` or `evergreen migrate` to get started.\n");
      return;
    }
    console.log(`\nEvergreen Usage Summary`);
    console.log("─".repeat(50));
    console.log(`  Total events:  ${summary.totalEvents}`);
    console.log(`  Total cost:    $${summary.totalCostUSD.toFixed(4)}`);
    console.log(`  Tokens:        ${summary.totalTokens.input.toLocaleString()} in / ${summary.totalTokens.output.toLocaleString()} out`);
    console.log(`  PRs created:   ${summary.prsCreated}`);
    console.log(`\nBy event type:`);
    for (const [k, v] of Object.entries(summary.byEvent)) console.log(`  ${k.padEnd(15)} ${v}`);
    console.log(`\nBy provider:`);
    for (const [k, v] of Object.entries(summary.byProvider)) console.log(`  ${k.padEnd(15)} ${v}`);
    console.log(`\nBy repository:`);
    for (const [k, v] of Object.entries(summary.byRepo)) console.log(`  ${k.padEnd(15)} ${v}`);
    if (summary.recentEvents.length > 0) {
      const count = Math.min(summary.recentEvents.length, parseInt(o.limit, 10));
      console.log(`\nRecent events (last ${count}):`);
      for (const e of summary.recentEvents.slice(0, count)) {
        const ts = e.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
        console.log(`  ${ts}  ${e.event.padEnd(10)} ${e.repo}  $${e.usage.costUSD.toFixed(4)}  ${e.provider}`);
      }
    }
    console.log();
  });

program
  .command("providers")
  .description("List available LLM providers and their configuration status (FR-09)")
  .action(async () => {
    const { listAvailableProviders } = await import("./providers/registry.js");
    const providers = listAvailableProviders();
    console.log("\nAvailable LLM Providers:\n");
    console.log("  Status  | ID                | Name");
    console.log("  --------+-------------------+-------------------------------------");
    for (const { preset, configured } of providers) {
      const status = configured ? "  ✓ ready" : "  ✗ needs key";
      console.log(`${status.padEnd(10)}| ${preset.id.padEnd(18)}| ${preset.name}`);
    }
    console.log(`\nTo use a provider: evergreen migrate --spec <file> --provider <id>`);
    console.log(`Or set MIGRATION_PROVIDER=<id> in your environment.\n`);
  });

function fail(e: unknown): void {
  if (e instanceof SpecValidationError) {
    console.error(e.message);
    process.exitCode = 1;
  } else if (e instanceof GitSafetyError) {
    console.error(`Git safety: ${e.message}`);
    process.exitCode = 5;
  } else if ((e as Error).message?.includes("ANTHROPIC_API_KEY") || (e as Error).message?.toLowerCase().includes("auth")) {
    console.error(`Credentials missing: set ANTHROPIC_API_KEY or sign in to Claude Code. (${(e as Error).message})`);
    process.exitCode = 4;
  } else {
    console.error((e as Error).stack ?? String(e));
    process.exitCode = 3;
  }
}

program.parseAsync();
