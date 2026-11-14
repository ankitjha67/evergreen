#!/usr/bin/env node
// FR-07 - CLI shell. The ONLY file that reads argv (ARCHITECTURE.md S5).
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { migrate, scanOnly, GitSafetyError } from "./orchestrator.js";
import { renderScanTable } from "./scanner/scan.js";
import { SpecValidationError } from "./types.js";

const program = new Command();
program.name("evergreen").description("Self-maintaining APIs: scan and migrate codebases when API vendors ship breaking changes.").version("0.9.0");

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
  console.log(`\nTriage (claude-haiku-5-5)${t.degraded ? ` - DEGRADED: ${t.degraded}` : ""}`);
  for (const v of t.verdicts) console.log(`  ${String(v.verdict).padEnd(13)} ${v.file}:${v.line} [${v.ruleId}] - ${v.reason}`);
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
      console.log(`  ${f.status.padEnd(9)} ${f.path}  (confidence ${f.confidence.toFixed(2)}) - ${f.summary}`);
    }
  }
  for (const g of outcome.gated) console.log(`  gated     ${g.path} (confidence ${g.confidence.toFixed(2)} < threshold, reverted)`);
  for (const v of outcome.violations) console.log(`  violation ${v}`);
  if (outcome.verify) console.log(`Verify: ${outcome.verify.command} -> exit ${outcome.verify.exitCode}`);
  if (outcome.usage)
    console.log(
      `Cost: $${outcome.usage.costUSD} (in ${outcome.usage.inputTokens.toLocaleString()} / cache-read ${outcome.usage.cacheReadTokens.toLocaleString()} / cache-write ${outcome.usage.cacheCreationTokens.toLocaleString()} / out ${outcome.usage.outputTokens.toLocaleString()})`,
    );
  console.log(`Report: .evergreen/MIGRATION_REPORT.md${outcome.branch ? ` (committed on ${outcome.branch})` : ""}`);
}

program
  .command("validate")
  .description("Validate a changefeed spec JSON file")
  .argument("<file>", "path to changefeed spec JSON")
  .option("--json", "machine-readable output", false)
  .action(async (file: string, o: { json: boolean }) => {
    try {
      const { loadSpec } = await import("./changefeed/loader.js");
      const { specRef } = await import("./types.js");
      const spec = await loadSpec(resolve(file));
      if (o.json) {
        console.log(JSON.stringify({ valid: true, ref: specRef(spec), rules: spec.changes.length, languages: spec.languages }));
      } else {
        console.log(`\nValid changefeed spec`);
        console.log(`  Ref:       ${specRef(spec)}`);
        console.log(`  Title:     ${spec.title}`);
        console.log(`  Vendor:    ${spec.vendor}`);
        console.log(`  API:       ${spec.api} ${spec.version}`);
        console.log(`  Languages: ${spec.languages.join(", ")}`);
        console.log(`  Rules:     ${spec.changes.length}`);
        if (spec.deadline) console.log(`  Deadline:  ${spec.deadline}`);
        console.log(`\nRules:`);
        for (const c of spec.changes) {
          console.log(`  [${c.severity.padEnd(12)}] ${c.id}: ${c.title}`);
          console.log(`               ${c.detect.patterns.length} pattern(s), ${c.detect.filePatterns.join(", ")}`);
        }
        console.log();
      }
    } catch (e) {
      if (e instanceof SpecValidationError) {
        if (o.json) {
          console.log(JSON.stringify({ valid: false, errors: e.message.split("\n") }));
        } else {
          console.error(`\nInvalid spec: ${file}\n${e.message}\n`);
        }
        process.exitCode = 1;
      } else {
        console.error((e as Error).message);
        process.exitCode = 1;
      }
    }
  });

program
  .command("init")
  .description("Create a .evergreen.yaml config file in the current repo")
  .option("--repo <path>", "target repository", process.cwd())
  .action(async (o) => {
    const { writeFile, access } = await import("node:fs/promises");
    const configPath = join(resolve(o.repo), ".evergreen.yaml");
    try {
      await access(configPath);
      console.error(`.evergreen.yaml already exists at ${configPath}`);
      process.exitCode = 1;
      return;
    } catch { /* file doesn't exist - proceed */ }

    const template = `# Evergreen configuration - controls how migrations run in this repo.
# See: https://github.com/ankitjha67/evergreen

# LLM provider for migrations (default: anthropic)
# provider: anthropic

# Model override (default: provider's default model)
# model: claude-opus-5-5

# Confidence threshold - files below this score are reverted (0..1)
threshold: 0.7

# Verify command - runs after migration to check nothing broke
# verify: npm test

# Auto-triage findings with Haiku before migrating
triage: true

# Specs to watch (vendor@api references). Empty = scan against all bundled specs.
# specs:
#   - stripe@stripe-node@2025-03-31.basil
#   - stripe@stripe-python@2025-03-31.basil
`;
    await writeFile(configPath, template, "utf8");
    console.log(`Created .evergreen.yaml at ${configPath}`);
  });

// evergreen diff - preview what migration would change, without running the agent
common(program.command("diff").description("Preview which files and rules a migration would touch (scan + rule detail, no agent run)"))
  .option("--triage", "triage findings first", false)
  .action(async (o) => {
    try {
      const { spec, outcome } = await scanOnly({ repo: o.repo, specPath: o.spec, triage: o.triage, json: false });
      const findings = outcome.triage
        ? outcome.triage.verdicts.filter((v: any) => v.verdict !== "not_affected")
        : outcome.scan.findings;

      if (findings.length === 0) {
        console.log("\nNo affected code found. Nothing to migrate.\n");
        process.exitCode = 0;
        return;
      }

      // Group findings by file
      const byFile = new Map<string, any[]>();
      for (const f of findings) {
        const arr = byFile.get(f.file) ?? [];
        arr.push(f);
        byFile.set(f.file, arr);
      }

      const ruleMap = new Map(spec.changes.map((c) => [c.id, c]));

      if (o.json) {
        const files = [...byFile.entries()].map(([file, hits]) => ({
          file,
          findings: hits.map((h: any) => ({
            line: h.line,
            ruleId: h.ruleId,
            matchText: h.matchText,
            guidance: ruleMap.get(h.ruleId)?.replace.guidance,
          })),
        }));
        console.log(JSON.stringify({ specRef: outcome.specRef, files, totalFindings: findings.length }, null, 2));
      } else {
        console.log(`\nMigration preview: ${outcome.specRef}`);
        console.log(`${findings.length} finding(s) across ${byFile.size} file(s)\n`);

        for (const [file, hits] of byFile) {
          console.log(`  ${file} (${hits.length} finding${hits.length > 1 ? "s" : ""})`);
          for (const h of hits) {
            const rule = ruleMap.get(h.ruleId);
            console.log(`    L${h.line}: [${h.ruleId}] ${h.matchText}`);
            if (rule?.replace.before && rule?.replace.after) {
              console.log(`      - ${rule.replace.before}`);
              console.log(`      + ${rule.replace.after}`);
            } else if (rule?.replace.guidance) {
              console.log(`      -> ${rule.replace.guidance.slice(0, 100)}`);
            }
          }
          console.log();
        }
      }
      process.exitCode = 0;
    } catch (e) {
      fail(e);
    }
  });

// evergreen fetch-spec - download a changefeed spec from a URL
program
  .command("fetch-spec")
  .description("Download a changefeed spec from a URL and save to specs/")
  .argument("<url>", "HTTP(S) URL to a changefeed spec JSON")
  .option("--out <dir>", "output directory", "specs")
  .action(async (url: string, o: { out: string }) => {
    try {
      const { fetchSpec } = await import("./changefeed/fetch.js");
      const { specRef } = await import("./types.js");
      const result = await fetchSpec(url, resolve(o.out));
      console.log(`\nFetched and validated spec: ${specRef(result.spec)}`);
      console.log(`  Saved to: ${result.savedTo}`);
      console.log(`  Title:    ${result.spec.title}`);
      console.log(`  Rules:    ${result.spec.changes.length}\n`);
    } catch (e: any) {
      console.error(`Failed to fetch spec: ${e.message}`);
      process.exitCode = 1;
    }
  });

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

// evergreen specs - list all bundled changefeed specs
program
  .command("specs")
  .description("List all bundled changefeed specs")
  .option("--specs-dir <path>", "directory containing specs", "specs")
  .option("--json", "machine-readable output", false)
  .option("--lang <language>", "filter by language")
  .action(async (o) => {
    const { SpecRegistry } = await import("./registry/specs.js");
    const { specRef } = await import("./types.js");
    const registry = new SpecRegistry();
    await registry.loadFromDirectory(resolve(o.specsDir));

    let specs = registry.allSpecs();
    if (o.lang) specs = specs.filter((s) => s.languages.includes(o.lang));

    if (o.json) {
      console.log(JSON.stringify(specs.map((s) => ({
        ref: specRef(s), vendor: s.vendor, api: s.api, version: s.version,
        title: s.title, languages: s.languages, rules: s.changes.length, deadline: s.deadline,
      })), null, 2));
      return;
    }

    if (specs.length === 0) {
      console.log(o.lang ? `\nNo specs found for language: ${o.lang}\n` : "\nNo specs found.\n");
      return;
    }

    console.log(`\nBundled Changefeed Specs (${specs.length}):\n`);
    for (const s of specs) {
      console.log(`  ${specRef(s)}`);
      console.log(`    ${s.title}`);
      console.log(`    Languages: ${s.languages.join(", ")} | Rules: ${s.changes.length}${s.deadline ? ` | Deadline: ${s.deadline}` : ""}`);
      console.log();
    }
  });

// evergreen scan-all - scan a repo against all matching specs
program
  .command("scan-all")
  .description("Scan a repo against all bundled specs matching its language")
  .option("--repo <path>", "target repository", process.cwd())
  .option("--specs-dir <path>", "directory containing specs", "specs")
  .option("--lang <language>", "filter specs by language (auto-detect if omitted)")
  .option("--json", "machine-readable output", false)
  .action(async (o) => {
    try {
      const { SpecRegistry } = await import("./registry/specs.js");
      const { specRef } = await import("./types.js");
      const { scan } = await import("./scanner/scan.js");
      const { loadRepoConfig } = await import("./config.js");

      const registry = new SpecRegistry();
      await registry.loadFromDirectory(resolve(o.specsDir));

      const repo = resolve(o.repo);
      const cfg = await loadRepoConfig(repo);

      // Auto-detect language from repo if not specified
      let specs = registry.allSpecs();
      if (o.lang) {
        specs = specs.filter((s) => s.languages.includes(o.lang));
      }

      if (specs.length === 0) {
        console.log("\nNo matching specs found.\n");
        process.exitCode = 0;
        return;
      }

      // Scan concurrently against all specs
      const results = await Promise.all(
        specs.map(async (spec) => {
          const result = await scan(repo, spec, cfg);
          return { spec, result, ref: specRef(spec) };
        }),
      );

      const affected = results.filter((r) => r.result.findings.length > 0);

      if (o.json) {
        console.log(JSON.stringify({
          repo,
          specsScanned: results.length,
          specsAffected: affected.length,
          results: results.map((r) => ({
            specRef: r.ref,
            findings: r.result.findings.length,
            scannedFiles: r.result.scannedFiles,
            durationMs: r.result.durationMs,
          })),
        }, null, 2));
      } else {
        console.log(`\nScan-all: ${results.length} spec(s) checked against ${repo}\n`);

        if (affected.length === 0) {
          console.log("  No breaking changes detected. All clear.\n");
        } else {
          console.log(`  ${affected.length} spec(s) found affected code:\n`);
          for (const r of affected) {
            const byRule = new Map<string, number>();
            for (const f of r.result.findings) {
              byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
            }
            console.log(`  ${r.ref} - ${r.result.findings.length} finding(s) in ${r.result.scannedFiles} files (${r.result.durationMs}ms)`);
            for (const [rule, count] of byRule) {
              console.log(`    ${rule}: ${count} match${count > 1 ? "es" : ""}`);
            }
            console.log();
          }
        }

        const clean = results.filter((r) => r.result.findings.length === 0);
        if (clean.length > 0) {
          console.log(`  Clean specs: ${clean.map((r) => r.ref).join(", ")}\n`);
        }
      }
      process.exitCode = 0;
    } catch (e) {
      fail(e);
    }
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
