// Canonical shared types - SYSTEM_DESIGN.md §4. Changes here update that doc first.

// FR-01
export interface BreakingChangeSpec {
  specVersion: "1";
  vendor: string;
  api: string;
  version: string;
  title: string;
  docsUrl?: string;
  deadline?: string;
  languages: string[];
  changes: ChangeRule[];
}

export interface ChangeRule {
  id: string;
  severity: "breaking" | "deprecation" | "behavioral";
  title: string;
  description: string;
  detect: { patterns: string[]; filePatterns: string[]; notes?: string };
  replace: { guidance: string; before?: string; after?: string; docsUrl?: string };
}

// FR-03
export interface Finding {
  ruleId: string;
  file: string; // repo-relative, posix separators
  line: number; // 1-based
  column: number; // 1-based
  matchText: string;
  lineText: string;
}

export interface ScanResult {
  specRef: string;
  repo: string;
  scannedFiles: number;
  skippedFiles: string[];
  findings: Finding[];
  startedAt: string;
  durationMs: number;
}

// FR-04.4
export interface ManifestFileEntry {
  path: string;
  rules: string[];
  status: "migrated" | "skipped" | "partial";
  confidence: number; // 0..1
  summary: string;
  reasons?: string[];
}

export interface ChangeManifest {
  specRef: string;
  engine: { model: string };
  files: ManifestFileEntry[];
  notes?: string;
}

export interface MigrationOutcome {
  specRef: string;
  repo: string;
  branch?: string;
  scan: ScanResult;
  // FR-03.2
  triage?: {
    verdicts: (Finding & { verdict: "affected" | "not_affected" | "uncertain"; reason: string })[];
    usage?: TokenUsage;
    degraded?: string;
  };
  manifest?: ChangeManifest;
  gated: { path: string; confidence: number }[];
  violations: string[];
  verify?: { command: string; exitCode: number; tail: string };
  usage?: TokenUsage;
  status: "migrated" | "not_affected" | "report_only" | "failed";
}

// NFR-6 - all four token classes (SYSTEM_DESIGN §6.4)
export interface TokenUsage {
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  costUSD: number;
}

// FR-07.2
export interface RepoConfig {
  ignore?: string[];
  verifyCommand?: string;
  confidenceThreshold?: number;
  model?: string;
  provider?: string;
  fallbackProviders?: string[];
  maxInputTokens?: number;
  maxOutputTokens?: number;
  scope?: string[];
}

export interface MigrateOptions {
  repo: string;
  specPath: string;
  dryRun?: boolean;
  triage?: boolean;
  verify?: boolean;
  allowDirty?: boolean;
  noGit?: boolean;
  model?: string;
  provider?: string;
  threshold?: number;
  json?: boolean;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  fallbackProviders?: string[];
  scope?: string[];
}

export class SpecValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid changefeed spec:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "SpecValidationError";
  }
}

export const specRef = (s: BreakingChangeSpec): string => `${s.vendor}@${s.api}@${s.version}`;
