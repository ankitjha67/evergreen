// Config doctor - validate environment, config, providers, and spec integrity
import { access, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadRepoConfig } from "./config.js";

export interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
  fix?: string;
}

export interface DoctorReport {
  checks: CheckResult[];
  ok: number;
  warnings: number;
  failures: number;
  healthy: boolean;
}

export async function runDoctor(repo: string, specsDir: string): Promise<DoctorReport> {
  const checks: CheckResult[] = [];

  checks.push(await checkNodeVersion());
  checks.push(await checkRepoConfig(repo));
  checks.push(await checkSpecsDirectory(specsDir));
  checks.push(...await checkProviderAuth());
  checks.push(await checkGitRepo(repo));
  checks.push(await checkEvergreenDir(repo));
  checks.push(await checkSpecIntegrity(specsDir));

  const ok = checks.filter((c) => c.status === "ok").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const failures = checks.filter((c) => c.status === "fail").length;

  return { checks, ok, warnings, failures, healthy: failures === 0 };
}

async function checkNodeVersion(): Promise<CheckResult> {
  const major = parseInt(process.version.slice(1), 10);
  if (major >= 20) {
    return { name: "Node.js version", status: "ok", message: `${process.version} (>= 20 required)` };
  }
  return { name: "Node.js version", status: "fail", message: `${process.version} is too old`, fix: "Upgrade to Node.js >= 20" };
}

async function checkRepoConfig(repo: string): Promise<CheckResult> {
  try {
    const cfg = await loadRepoConfig(repo);
    const hasConfig = Object.keys(cfg).length > 0;
    if (hasConfig) {
      const parts: string[] = [];
      if (cfg.provider) parts.push(`provider=${cfg.provider}`);
      if (cfg.model) parts.push(`model=${cfg.model}`);
      if (cfg.confidenceThreshold !== undefined) parts.push(`threshold=${cfg.confidenceThreshold}`);
      if (cfg.verifyCommand) parts.push(`verify=${cfg.verifyCommand}`);
      return { name: "Repo config", status: "ok", message: `Found config: ${parts.join(", ") || "default settings"}` };
    }
    return { name: "Repo config", status: "warn", message: "No .evergreen.yaml or .evergreen.json found", fix: "Run `evergreen init` to create a config file" };
  } catch (e: any) {
    return { name: "Repo config", status: "fail", message: `Config error: ${e.message}`, fix: "Fix config file syntax" };
  }
}

async function checkSpecsDirectory(specsDir: string): Promise<CheckResult> {
  const dir = resolve(specsDir);
  try {
    const files = await readdir(dir);
    const specs = files.filter((f) => f.endsWith(".json") && f !== "checksums.json");
    if (specs.length === 0) {
      return { name: "Specs directory", status: "warn", message: `${dir} exists but contains no spec files`, fix: "Add changefeed spec JSON files or use `evergreen fetch-spec`" };
    }
    return { name: "Specs directory", status: "ok", message: `${specs.length} spec file(s) in ${dir}` };
  } catch {
    return { name: "Specs directory", status: "warn", message: `Specs directory not found: ${dir}`, fix: "Create specs/ directory and add changefeed specs" };
  }
}

async function checkProviderAuth(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    results.push({ name: "Anthropic API key", status: "ok", message: `ANTHROPIC_API_KEY set (${anthropicKey.slice(0, 8)}...)` });
  } else {
    results.push({ name: "Anthropic API key", status: "warn", message: "ANTHROPIC_API_KEY not set", fix: "Set ANTHROPIC_API_KEY for Anthropic provider" });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    results.push({ name: "OpenAI API key", status: "ok", message: `OPENAI_API_KEY set (${openaiKey.slice(0, 8)}...)` });
  }

  const geminiKey = process.env.GOOGLE_AI_API_KEY;
  if (geminiKey) {
    results.push({ name: "Google AI API key", status: "ok", message: `GOOGLE_AI_API_KEY set (${geminiKey.slice(0, 8)}...)` });
  }

  const migrationProvider = process.env.MIGRATION_PROVIDER;
  if (migrationProvider) {
    results.push({ name: "Migration provider", status: "ok", message: `MIGRATION_PROVIDER=${migrationProvider}` });
  }

  if (!anthropicKey && !openaiKey && !geminiKey) {
    results.push({ name: "LLM provider", status: "fail", message: "No LLM provider API keys configured", fix: "Set at least one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY" });
  }

  return results;
}

async function checkGitRepo(repo: string): Promise<CheckResult> {
  try {
    await access(join(resolve(repo), ".git"));
    return { name: "Git repository", status: "ok", message: "Git repository detected" };
  } catch {
    return { name: "Git repository", status: "warn", message: "Not a git repository", fix: "Run `git init` to initialize a repository (needed for branch-based migrations)" };
  }
}

async function checkEvergreenDir(repo: string): Promise<CheckResult> {
  try {
    await access(join(resolve(repo), ".evergreen"));
    return { name: "Evergreen data dir", status: "ok", message: ".evergreen/ directory exists (migration reports stored here)" };
  } catch {
    return { name: "Evergreen data dir", status: "ok", message: ".evergreen/ not yet created (will be created on first migration)" };
  }
}

async function checkSpecIntegrity(specsDir: string): Promise<CheckResult> {
  const dir = resolve(specsDir);
  try {
    const files = await readdir(dir);
    if (!files.includes("checksums.json")) {
      return { name: "Spec integrity", status: "warn", message: "No checksums.json manifest", fix: "Run `evergreen verify-specs --generate` to create integrity checksums" };
    }

    const { verifySpecs } = await import("./changefeed/integrity.js");
    const specFiles = files.filter((f) => f.endsWith(".json") && f !== "checksums.json");
    const results = await verifySpecs(dir, specFiles);

    const mismatches = results.filter((r) => r.status === "mismatch");
    if (mismatches.length > 0) {
      return { name: "Spec integrity", status: "fail", message: `${mismatches.length} spec(s) failed integrity check`, fix: "Run `evergreen verify-specs` for details" };
    }

    return { name: "Spec integrity", status: "ok", message: `All ${specFiles.length} spec(s) pass integrity check` };
  } catch {
    return { name: "Spec integrity", status: "ok", message: "Spec integrity check skipped (no specs directory)" };
  }
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];

  lines.push("Evergreen Doctor");
  lines.push("─".repeat(50));

  for (const check of report.checks) {
    const icon = check.status === "ok" ? "✓" : check.status === "warn" ? "!" : "✗";
    lines.push(`  ${icon} ${check.name}: ${check.message}`);
    if (check.fix) lines.push(`    Fix: ${check.fix}`);
  }

  lines.push("");
  lines.push(`${report.ok} passed, ${report.warnings} warning(s), ${report.failures} failure(s)`);

  if (report.healthy) {
    lines.push("\nEvergreen is healthy and ready to run.");
  } else {
    lines.push("\nFix the failures above before running migrations.");
  }

  return lines.join("\n");
}
