// FR-06 - Batch repo scanning: scan multiple repos from a manifest file
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SpecRegistry } from "./registry/specs.js";
import { scan } from "./scanner/scan.js";
import { specRef, BreakingChangeSpec, ScanResult } from "./types.js";
import { loadRepoConfig } from "./config.js";

export interface BatchManifest {
  repos: string[];
}

export interface BatchRepoResult {
  repo: string;
  specRef: string;
  findings: number;
  scannedFiles: number;
  durationMs: number;
  error?: string;
}

export interface BatchResult {
  totalRepos: number;
  totalSpecs: number;
  results: BatchRepoResult[];
  reposAffected: number;
  totalFindings: number;
  durationMs: number;
}

export async function loadManifest(path: string): Promise<BatchManifest> {
  const raw = await readFile(path, "utf8");
  const ext = path.toLowerCase();

  if (ext.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { repos: parsed };
    if (parsed.repos && Array.isArray(parsed.repos)) return parsed;
    throw new Error("Manifest JSON must be an array of paths or {repos: [...]}");
  }

  // Plain text: one repo path per line
  const repos = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (repos.length === 0) throw new Error("Manifest is empty");
  return { repos };
}

export async function batchScan(
  manifest: BatchManifest,
  specsDir: string,
  options: { lang?: string; concurrency?: number },
): Promise<BatchResult> {
  const start = Date.now();

  const registry = new SpecRegistry();
  await registry.loadFromDirectory(resolve(specsDir));

  let specs: BreakingChangeSpec[] = registry.allSpecs();
  if (options.lang) specs = specs.filter((s) => s.languages.includes(options.lang!));

  if (specs.length === 0) throw new Error("No specs match the given filters");

  const results: BatchRepoResult[] = [];
  const concurrency = Math.min(options.concurrency ?? 4, 8);

  // Process repos in batches
  for (let i = 0; i < manifest.repos.length; i += concurrency) {
    const batch = manifest.repos.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (repoPath) => {
        const repo = resolve(repoPath);
        const repoResults: BatchRepoResult[] = [];

        let cfg = {};
        try { cfg = await loadRepoConfig(repo); } catch { /* use defaults */ }

        for (const spec of specs) {
          try {
            const result: ScanResult = await scan(repo, spec, cfg);
            repoResults.push({
              repo: repoPath,
              specRef: specRef(spec),
              findings: result.findings.length,
              scannedFiles: result.scannedFiles,
              durationMs: result.durationMs,
            });
          } catch (e: any) {
            repoResults.push({
              repo: repoPath,
              specRef: specRef(spec),
              findings: 0,
              scannedFiles: 0,
              durationMs: 0,
              error: e.message,
            });
          }
        }
        return repoResults;
      }),
    );
    results.push(...batchResults.flat());
  }

  const affectedRepos = new Set(results.filter((r) => r.findings > 0).map((r) => r.repo));

  return {
    totalRepos: manifest.repos.length,
    totalSpecs: specs.length,
    results,
    reposAffected: affectedRepos.size,
    totalFindings: results.reduce((sum, r) => sum + r.findings, 0),
    durationMs: Date.now() - start,
  };
}
