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
    .option("--scope <paths>", "monorepo scope: comma-separated workspace paths (e.g. packages/api,packages/web)")
    .option("--json", "machine-readable output", false);

common(program.command("scan").description("Find code affected by a breaking-change spec (read-only)"))
  .option("--triage", "run Haiku triage on findings (FR-03.2)", false)
  .action(async (o) => {
    try {
      const { spec, outcome } = await scanOnly({ repo: o.repo, specPath: o.spec, triage: o.triage, json: o.json, scope: o.scope ? o.scope.split(",").map((s: string) => s.trim()) : undefined });
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
  .option("--max-input-tokens <n>", "max input tokens per request", parseInt)
  .option("--max-output-tokens <n>", "max output tokens per response", parseInt)
  .option("--fallback <ids>", "comma-separated fallback provider IDs")
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
        maxInputTokens: o.maxInputTokens,
        maxOutputTokens: o.maxOutputTokens,
        fallbackProviders: o.fallback ? o.fallback.split(",").map((s: string) => s.trim()) : undefined,
        scope: o.scope ? o.scope.split(",").map((s: string) => s.trim()) : undefined,
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

# Model override (default: auto-discovered from provider API)
# model: claude-opus-5-5

# Confidence threshold - files below this score are reverted (0..1)
threshold: 0.7

# Verify command - runs after migration to check nothing broke
# verify: npm test

# Auto-triage findings with Haiku before migrating
triage: true

# Token limits - adjust per provider/model requirements
# maxInputTokens: 200000
# maxOutputTokens: 16384

# Fallback providers - tried in order if primary fails (model deprecated, API down, etc.)
# fallback:
#   - openai
#   - gemini

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
      const { spec, outcome } = await scanOnly({ repo: o.repo, specPath: o.spec, triage: o.triage, json: false, scope: o.scope ? o.scope.split(",").map((s: string) => s.trim()) : undefined });
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

// evergreen fetch-registry - download specs from a remote registry index
program
  .command("fetch-registry")
  .description("Download changefeed specs from a remote registry index URL")
  .argument("<url>", "HTTP(S) URL to a registry index JSON")
  .option("--out <dir>", "output directory", "specs")
  .option("--lang <language>", "filter by language (e.g. ruby, go, python)")
  .option("--vendor <vendor>", "filter by vendor slug (e.g. stripe)")
  .action(async (url: string, o: { out: string; lang?: string; vendor?: string }) => {
    try {
      const { fetchFromIndex } = await import("./changefeed/registry-index.js");
      const result = await fetchFromIndex(url, resolve(o.out), { lang: o.lang, vendor: o.vendor });

      if (result.fetched.length > 0) {
        console.log(`\nFetched ${result.fetched.length} spec(s):`);
        for (const f of result.fetched) {
          console.log(`  ${f.savedTo}`);
        }
      }
      if (result.errors.length > 0) {
        console.log(`\nErrors (${result.errors.length}):`);
        for (const e of result.errors) {
          console.error(`  ${e.ref}: ${e.error}`);
        }
        process.exitCode = 1;
      }
      if (result.fetched.length === 0 && result.errors.length === 0) {
        console.log("No specs matched the filters.");
      }
      console.log();
    } catch (e: any) {
      console.error(`Failed to fetch registry: ${e.message}`);
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
  .option("--scope <paths>", "monorepo scope: comma-separated workspace paths")
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
      if (o.scope) cfg.scope = o.scope.split(",").map((s: string) => s.trim());

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
  .option("--discover", "ping configured providers to discover available models", false)
  .option("--json", "machine-readable output", false)
  .action(async (o) => {
    const { listAvailableProviders, discoverProviderModels } = await import("./providers/registry.js");
    const providers = listAvailableProviders();

    if (o.json) {
      const result = [];
      for (const { preset, configured } of providers) {
        const entry: any = { id: preset.id, name: preset.name, configured, defaultModel: preset.defaultModel };
        if (o.discover && configured) {
          try {
            entry.models = await discoverProviderModels(preset.id);
          } catch { entry.models = []; }
        }
        result.push(entry);
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log("\nAvailable LLM Providers:\n");
    console.log("  Status  | ID                | Name                                 | Default Model");
    console.log("  --------+-------------------+--------------------------------------+---------------------------");
    for (const { preset, configured } of providers) {
      const status = configured ? "  ✓ ready" : "  ✗ needs key";
      console.log(`${status.padEnd(10)}| ${preset.id.padEnd(18)}| ${preset.name.padEnd(37)}| ${preset.defaultModel}`);
    }

    if (o.discover) {
      const configured = providers.filter((p) => p.configured);
      if (configured.length > 0) {
        console.log("\nDiscovering models from configured providers...\n");
        for (const { preset } of configured) {
          try {
            const models = await discoverProviderModels(preset.id);
            if (models.length > 0) {
              console.log(`  ${preset.name} (${models.length} models):`);
              for (const m of models.slice(0, 10)) {
                const ctx = m.contextWindow ? `  ctx:${(m.contextWindow / 1000).toFixed(0)}k` : "";
                const out = m.maxOutputTokens ? `  out:${(m.maxOutputTokens / 1000).toFixed(0)}k` : "";
                console.log(`    ${m.id}${ctx}${out}`);
              }
              if (models.length > 10) console.log(`    ... and ${models.length - 10} more`);
            } else {
              console.log(`  ${preset.name}: no models returned (check API key)`);
            }
          } catch (e: any) {
            console.log(`  ${preset.name}: discovery failed - ${e.message}`);
          }
        }
      }
    }

    console.log(`\nTo use a provider: evergreen migrate --spec <file> --provider <id>`);
    console.log(`Or set MIGRATION_PROVIDER=<id> in your environment.`);
    console.log(`To configure fallback: MIGRATION_FALLBACK_PROVIDERS=openai,gemini or use .evergreen.yaml\n`);
  });

// evergreen openapi-diff - generate changefeed spec from OpenAPI schema diff
program
  .command("openapi-diff")
  .description("Generate a changefeed spec from two OpenAPI schemas (before & after)")
  .argument("<before>", "path to the old OpenAPI schema JSON/YAML")
  .argument("<after>", "path to the new OpenAPI schema JSON/YAML")
  .requiredOption("--vendor <slug>", "vendor slug (e.g. stripe)")
  .requiredOption("--api <name>", "API name (e.g. stripe-node)")
  .requiredOption("--version <ver>", "version string (e.g. 2025-03-31)")
  .option("--lang <languages>", "comma-separated languages", "javascript,typescript")
  .option("--out <file>", "output file path")
  .option("--json", "output to stdout as JSON", false)
  .action(async (beforePath: string, afterPath: string, o: any) => {
    try {
      const { generateSpecFromDiff } = await import("./changefeed/openapi-diff.js");
      const { writeFile } = await import("node:fs/promises");

      const beforeRaw = await readFile(resolve(beforePath), "utf8");
      const afterRaw = await readFile(resolve(afterPath), "utf8");
      const before = JSON.parse(beforeRaw);
      const after = JSON.parse(afterRaw);

      const spec = generateSpecFromDiff(before, after, {
        vendor: o.vendor,
        api: o.api,
        version: o.version,
        languages: o.lang.split(",").map((s: string) => s.trim()),
      });

      if (o.json || !o.out) {
        console.log(JSON.stringify(spec, null, 2));
      }
      if (o.out) {
        await writeFile(resolve(o.out), JSON.stringify(spec, null, 2), "utf8");
        console.log(`\nSpec written to ${resolve(o.out)} (${spec.changes.length} rules)`);
      }
    } catch (e: any) {
      console.error(`OpenAPI diff failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen verify-specs - verify spec integrity checksums
program
  .command("verify-specs")
  .description("Verify integrity of bundled specs via SHA-256 checksums")
  .option("--specs-dir <path>", "directory containing specs", "specs")
  .option("--generate", "generate checksum manifest instead of verifying", false)
  .option("--json", "machine-readable output", false)
  .action(async (o) => {
    try {
      const { verifySpecs, generateChecksumManifest, saveChecksumManifest } = await import("./changefeed/integrity.js");
      const { readdirSync } = await import("node:fs");
      const dir = resolve(o.specsDir);
      const specFiles = readdirSync(dir).filter((f: string) => f.endsWith(".json") && f !== "checksums.json");

      if (o.generate) {
        const manifest = await generateChecksumManifest(dir, specFiles);
        const saved = await saveChecksumManifest(dir, manifest);
        console.log(`Generated checksum manifest: ${saved} (${manifest.checksums.length} specs)`);
        return;
      }

      const results = await verifySpecs(dir, specFiles);

      if (o.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      const ok = results.filter((r) => r.status === "ok");
      const mismatches = results.filter((r) => r.status === "mismatch");
      const newSpecs = results.filter((r) => r.status === "new");
      const missing = results.filter((r) => r.status === "missing");

      console.log(`\nSpec Integrity Verification (${results.length} files)`);
      console.log("─".repeat(50));
      for (const r of results) {
        const icon = r.status === "ok" ? "✓" : r.status === "new" ? "?" : "✗";
        console.log(`  ${icon} ${r.file}: ${r.status}`);
        if (r.status === "mismatch") {
          console.log(`    expected: ${r.expected}`);
          console.log(`    actual:   ${r.actual}`);
        }
      }
      console.log(`\n  ${ok.length} ok, ${newSpecs.length} new, ${mismatches.length} mismatch, ${missing.length} missing\n`);

      if (mismatches.length > 0) {
        console.log("  Run `evergreen verify-specs --generate` to update the manifest.");
        process.exitCode = 1;
      }
    } catch (e: any) {
      console.error(`Verify failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen estimate - estimate migration cost before running the agent
common(program.command("estimate").description("Estimate LLM cost for migrating a repo against a spec (no agent run)"))
  .option("--model <id>", "model to estimate for", "claude-opus-5-5")
  .option("--provider <id>", "provider", "anthropic")
  .action(async (o) => {
    try {
      const { scanOnly } = await import("./orchestrator.js");
      const { estimateMigrationCost } = await import("./estimate.js");
      const { specRef } = await import("./types.js");

      const { spec, outcome } = await scanOnly({ repo: o.repo, specPath: o.spec, triage: false, json: false, scope: o.scope ? o.scope.split(",").map((s: string) => s.trim()) : undefined });
      const findings = outcome.scan.findings;

      if (findings.length === 0) {
        console.log("\nNo findings - migration would cost $0.00\n");
        process.exitCode = 0;
        return;
      }

      const est = await estimateMigrationCost(resolve(o.repo), findings, o.model, o.provider);

      if (o.json) {
        console.log(JSON.stringify(est, null, 2));
      } else {
        console.log(`\nCost Estimate: ${specRef(spec)}`);
        console.log("─".repeat(50));
        console.log(`  Model:            ${est.model} (${est.provider})`);
        console.log(`  Findings:         ${est.findings}`);
        console.log(`  Affected files:   ${est.affectedFiles}`);
        console.log(`  Est. input tokens:  ${est.estimatedInputTokens.toLocaleString()}`);
        console.log(`  Est. output tokens: ${est.estimatedOutputTokens.toLocaleString()}`);
        console.log(`  Est. cost:        $${est.estimatedCostUSD}`);
        console.log(`  Confidence:       ${est.confidence}`);
        if (est.pricing) {
          console.log(`  Pricing:          $${est.pricing.inputPerMTok}/MTok in, $${est.pricing.outputPerMTok}/MTok out`);
        } else {
          console.log(`  Pricing:          (unknown model - cost is $0)`);
        }
        console.log();
      }
      process.exitCode = 0;
    } catch (e) {
      fail(e);
    }
  });

// evergreen batch-scan - scan multiple repos from a manifest
program
  .command("batch-scan")
  .description("Scan multiple repos from a manifest file against all matching specs")
  .argument("<manifest>", "path to manifest file (JSON array or newline-separated repo paths)")
  .option("--specs-dir <path>", "directory containing specs", "specs")
  .option("--lang <language>", "filter specs by language")
  .option("--concurrency <n>", "parallel repo scans", "4")
  .option("--json", "machine-readable output", false)
  .action(async (manifest: string, o: { specsDir: string; lang?: string; concurrency: string; json: boolean }) => {
    try {
      const { loadManifest, batchScan } = await import("./batch.js");
      const m = await loadManifest(resolve(manifest));
      console.log(`\nScanning ${m.repos.length} repo(s)...\n`);

      const result = await batchScan(m, o.specsDir, {
        lang: o.lang,
        concurrency: parseInt(o.concurrency, 10),
      });

      if (o.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Batch Scan Complete`);
        console.log("─".repeat(50));
        console.log(`  Repos scanned:   ${result.totalRepos}`);
        console.log(`  Specs checked:   ${result.totalSpecs}`);
        console.log(`  Repos affected:  ${result.reposAffected}`);
        console.log(`  Total findings:  ${result.totalFindings}`);
        console.log(`  Duration:        ${result.durationMs}ms`);

        const affected = result.results.filter((r) => r.findings > 0);
        if (affected.length > 0) {
          console.log(`\nAffected repos:`);
          for (const r of affected) {
            console.log(`  ${r.repo} | ${r.specRef} | ${r.findings} finding(s)`);
          }
        }

        const errors = result.results.filter((r) => r.error);
        if (errors.length > 0) {
          console.log(`\nErrors:`);
          for (const r of errors) {
            console.error(`  ${r.repo}: ${r.error}`);
          }
        }
        console.log();
      }
      process.exitCode = result.results.some((r) => r.error) ? 1 : 0;
    } catch (e: any) {
      console.error(`Batch scan failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen create-spec - guided spec creation wizard
program
  .command("create-spec")
  .description("Create a changefeed spec from structured input (wizard)")
  .requiredOption("--vendor <slug>", "vendor slug (e.g. stripe)")
  .requiredOption("--api <name>", "API name (e.g. stripe-node)")
  .requiredOption("--version <ver>", "version string (e.g. 2025-03-31)")
  .option("--title <title>", "spec title")
  .option("--lang <languages>", "comma-separated languages", "javascript,typescript")
  .option("--docs-url <url>", "documentation URL")
  .option("--deadline <date>", "deprecation deadline (ISO date)")
  .option("--from-json <file>", "import rules from a JSON file")
  .option("--out <file>", "output file path")
  .action(async (o: any) => {
    try {
      const { buildSpec, validateWizardInput, writeSpec, specFromJson } = await import("./create-spec.js");
      const { specRef } = await import("./types.js");

      const languages = o.lang.split(",").map((s: string) => s.trim());
      let input: any;

      if (o.fromJson) {
        const raw = await readFile(resolve(o.fromJson), "utf8");
        input = specFromJson(raw);
        input.vendor = o.vendor;
        input.api = o.api;
        input.version = o.version;
        if (o.title) input.title = o.title;
        if (o.docsUrl) input.docsUrl = o.docsUrl;
        if (o.deadline) input.deadline = o.deadline;
        input.languages = languages;
      } else {
        input = {
          vendor: o.vendor,
          api: o.api,
          version: o.version,
          title: o.title,
          docsUrl: o.docsUrl,
          deadline: o.deadline,
          languages,
          rules: [],
        };
      }

      const errors = validateWizardInput(input);
      if (errors.length > 0 && !o.fromJson) {
        // Spec with zero rules is valid only if --from-json provides them
        const nonRuleErrors = errors.filter((e: string) => !e.includes("at least one rule"));
        if (nonRuleErrors.length > 0) {
          console.error(`Validation errors:\n${nonRuleErrors.map((e: string) => `  - ${e}`).join("\n")}`);
          process.exitCode = 1;
          return;
        }
      }

      if (o.fromJson) {
        const fErrors = validateWizardInput(input);
        if (fErrors.length > 0) {
          console.error(`Validation errors:\n${fErrors.map((e: string) => `  - ${e}`).join("\n")}`);
          process.exitCode = 1;
          return;
        }
      }

      const spec = buildSpec(input);
      const outPath = o.out ?? `specs/${o.vendor}-${o.api}-${o.version.replace(/[^a-z0-9.-]/gi, "-")}.json`;

      await writeSpec(spec, resolve(outPath));
      console.log(`\nCreated changefeed spec: ${specRef(spec)}`);
      console.log(`  Title:     ${spec.title}`);
      console.log(`  Languages: ${spec.languages.join(", ")}`);
      console.log(`  Rules:     ${spec.changes.length}`);
      console.log(`  Saved to:  ${resolve(outPath)}\n`);
    } catch (e: any) {
      console.error(`Spec creation failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen history - migration history tracking
program
  .command("history")
  .description("Show migration run history with filtering and stats")
  .option("--repo <path>", "filter by repository path")
  .option("--spec <ref>", "filter by spec reference")
  .option("--status <status>", "filter by status (migrated, failed, not_affected, report_only)")
  .option("--since <date>", "filter by date (ISO format)")
  .option("--limit <n>", "max entries to show", "20")
  .option("--json", "machine-readable output", false)
  .action(async (o: any) => {
    try {
      const { queryHistory, formatHistorySummary } = await import("./history.js");
      const summary = await queryHistory({
        repo: o.repo,
        specRef: o.spec,
        status: o.status,
        since: o.since,
        limit: parseInt(o.limit, 10),
      });

      if (o.json) {
        console.log(JSON.stringify(summary, null, 2));
      } else {
        console.log();
        console.log(formatHistorySummary(summary));
        console.log();
      }
    } catch (e: any) {
      console.error(`History query failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen spec-diff - compare two spec versions
program
  .command("spec-diff")
  .description("Compare two changefeed spec versions to show added/removed/changed rules")
  .argument("<before>", "path to the older spec JSON")
  .argument("<after>", "path to the newer spec JSON")
  .option("--json", "machine-readable output", false)
  .action(async (beforePath: string, afterPath: string, o: { json: boolean }) => {
    try {
      const { loadSpec } = await import("./changefeed/loader.js");
      const { diffSpecs, formatSpecDiff } = await import("./spec-diff.js");

      const before = await loadSpec(resolve(beforePath));
      const after = await loadSpec(resolve(afterPath));
      const diff = diffSpecs(before, after);

      if (o.json) {
        console.log(JSON.stringify(diff, null, 2));
      } else {
        console.log();
        console.log(formatSpecDiff(diff));
        console.log();
      }
    } catch (e: any) {
      console.error(`Spec diff failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen doctor - config health check
program
  .command("doctor")
  .description("Validate environment, config, providers, and spec integrity")
  .option("--repo <path>", "target repository", process.cwd())
  .option("--specs-dir <path>", "directory containing specs", "specs")
  .option("--json", "machine-readable output", false)
  .action(async (o: any) => {
    try {
      const { runDoctor, formatDoctorReport } = await import("./doctor.js");
      const report = await runDoctor(resolve(o.repo), resolve(o.specsDir));

      if (o.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log();
        console.log(formatDoctorReport(report));
        console.log();
      }
      process.exitCode = report.healthy ? 0 : 1;
    } catch (e: any) {
      console.error(`Doctor failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen export - export data as CSV/JSON
program
  .command("export")
  .description("Export scan results, migration history, or findings as CSV/JSON")
  .argument("<target>", "what to export: history, scan, or findings")
  .option("--format <fmt>", "output format: json or csv", "csv")
  .option("--out <file>", "output file path (prints to stdout if omitted)")
  .option("--repo <path>", "filter by repository")
  .option("--spec <ref>", "filter by spec reference")
  .option("--since <date>", "filter by date (ISO format)")
  .option("--limit <n>", "max records", "1000")
  .action(async (target: string, o: any) => {
    try {
      const { exportData, parseExportFormat, parseExportTarget } = await import("./export.js");

      const result = await exportData({
        format: parseExportFormat(o.format),
        target: parseExportTarget(target),
        outPath: o.out,
        repo: o.repo,
        specRef: o.spec,
        since: o.since,
        limit: parseInt(o.limit, 10),
      });

      if (o.out) {
        console.log(`Exported ${result.records} record(s) to ${result.savedTo} (${result.format})`);
      } else {
        console.log(result.output);
      }
    } catch (e: any) {
      console.error(`Export failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen notify - send a test notification
program
  .command("notify")
  .description("Send a test notification to configured channels (Slack, webhook)")
  .option("--channel <type>", "channel type: slack, webhook, console", "console")
  .option("--url <url>", "webhook/Slack URL (overrides env)")
  .option("--message <msg>", "custom notification message", "Evergreen test notification")
  .action(async (o: any) => {
    try {
      const notif = await import("./notifications.js");

      const channels: Array<{ type: "slack" | "webhook" | "console"; url?: string; token?: string; channel?: string }> = o.url
        ? [{ type: o.channel, url: o.url }]
        : notif.parseChannelsFromEnv();

      if (channels.length === 0 && o.channel === "console") {
        channels.push({ type: "console" });
      }

      if (channels.length === 0) {
        console.error("No notification channels configured. Set SLACK_WEBHOOK_URL or NOTIFY_WEBHOOK_URL.");
        process.exitCode = 1;
        return;
      }

      const payload = {
        event: "scan_complete" as const,
        specRef: "test@test@0.0.0",
        repo: "test-repo",
        findingsCount: 0,
        summary: o.message,
        timestamp: new Date().toISOString(),
      };

      for (const ch of channels) {
        const result = await notif.sendNotification(ch, payload);
        if (result.ok) {
          console.log(`Notification sent via ${ch.type}${ch.url ? ` to ${ch.url}` : ""}`);
        } else {
          console.error(`Failed to send via ${ch.type}: ${result.error}`);
          process.exitCode = 1;
        }
      }
    } catch (e: any) {
      console.error(`Notification failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen rollback - undo a migration by deleting the evergreen branch
program
  .command("rollback")
  .description("Undo a migration by deleting its evergreen/* branch")
  .argument("[branch]", "migration branch to delete (omit to list)")
  .option("--repo <path>", "target repository", process.cwd())
  .action(async (branch: string | undefined, o: { repo: string }) => {
    try {
      const { listMigrationBranches, rollbackMigration, formatRollbackTargets } = await import("./rollback.js");
      const repo = resolve(o.repo);

      if (!branch) {
        const targets = await listMigrationBranches(repo);
        console.log();
        console.log(formatRollbackTargets(targets));
        console.log();
        return;
      }

      const result = await rollbackMigration(repo, branch);
      if (result.action === "not_found") {
        console.error(result.message);
        process.exitCode = 1;
      } else {
        console.log(result.message);
      }
    } catch (e: any) {
      console.error(`Rollback failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen templates - list available spec templates
program
  .command("templates")
  .description("List available changefeed spec templates for common APIs")
  .option("--lang <language>", "filter by language")
  .option("--vendor <vendor>", "filter by vendor")
  .option("--json", "machine-readable output", false)
  .action(async (o: any) => {
    try {
      const { listTemplates, formatTemplateLibrary } = await import("./templates.js");
      const lib = listTemplates({ language: o.lang, vendor: o.vendor });

      if (o.json) {
        console.log(JSON.stringify(lib, null, 2));
      } else {
        console.log();
        console.log(formatTemplateLibrary(lib));
        console.log();
      }
    } catch (e: any) {
      console.error(`Templates failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen from-template - create a spec from a template
program
  .command("from-template")
  .description("Create a changefeed spec from a built-in template")
  .argument("<id>", "template ID (e.g. stripe/stripe-node)")
  .requiredOption("--version <ver>", "version string for the spec")
  .option("--lang <languages>", "override languages (comma-separated)")
  .option("--out <file>", "output file path")
  .action(async (id: string, o: any) => {
    try {
      const { instantiateTemplate } = await import("./templates.js");
      const { writeSpec } = await import("./create-spec.js");
      const { specRef } = await import("./types.js");

      const overrides: Record<string, any> = {};
      if (o.lang) overrides.languages = o.lang.split(",").map((s: string) => s.trim());

      const spec = instantiateTemplate(id, o.version, overrides);
      const outPath = o.out ?? `specs/${spec.vendor}-${spec.api}-${spec.version.replace(/[^a-z0-9.-]/gi, "-")}.json`;

      await writeSpec(spec, resolve(outPath));
      console.log(`\nCreated spec from template: ${specRef(spec)}`);
      console.log(`  Template: ${id}`);
      console.log(`  Title:    ${spec.title}`);
      console.log(`  Rules:    ${spec.changes.length}`);
      console.log(`  Saved to: ${resolve(outPath)}\n`);
    } catch (e: any) {
      console.error(`Template instantiation failed: ${e.message}`);
      process.exitCode = 1;
    }
  });

// evergreen cost-compare - compare migration costs across models
common(program.command("cost-compare").description("Compare estimated migration costs across multiple LLM models"))
  .option("--models <ids>", "comma-separated model IDs to compare (default: all known models)")
  .action(async (o: any) => {
    try {
      const { scanOnly } = await import("./orchestrator.js");
      const { compareCosts, formatCostComparison } = await import("./cost-compare.js");

      const { outcome } = await scanOnly({ repo: o.repo, specPath: o.spec, triage: false, json: false, scope: o.scope ? o.scope.split(",").map((s: string) => s.trim()) : undefined });
      const findings = outcome.scan.findings;

      if (findings.length === 0) {
        console.log("\nNo findings - all models cost $0.00\n");
        process.exitCode = 0;
        return;
      }

      const models = o.models ? o.models.split(",").map((s: string) => s.trim()) : undefined;
      const comparison = await compareCosts(resolve(o.repo), findings, models);

      if (o.json) {
        console.log(JSON.stringify(comparison, null, 2));
      } else {
        console.log();
        console.log(formatCostComparison(comparison));
        console.log();
      }
    } catch (e) {
      fail(e);
    }
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
