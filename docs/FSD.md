# Functional Specification Document (FSD)
## Evergreen — Self-Maintaining APIs
**Version:** 1.0 | **Date:** 2026-11-13 | **Status:** Draft — living document
**Doc ID:** FSD | Upstream: [PRD.md](PRD.md) | Downstream: [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md), source code (modules carry FR-IDs)

Every functional requirement below has a stable **FR-ID**. Code modules reference these IDs in their header comment. Changes to behavior MUST update this document first (see [CONTEXT.md](CONTEXT.md) working agreement).

---

## FR-01 — Changefeed: BreakingChangeSpec

### FR-01.1 Spec format
A changefeed is a JSON document describing one versioned set of breaking changes from one vendor.

```jsonc
{
  "specVersion": "1",                    // format version of this schema
  "vendor": "stripe",                    // vendor slug, [a-z0-9-]
  "api": "stripe-node",                  // API/SDK surface this spec targets
  "version": "2025-03-31.basil",         // the vendor release introducing the changes
  "title": "Stripe API 2025-03-31 (basil) breaking changes",
  "docsUrl": "https://stripe.com/docs/upgrades#2025-03-31.basil",
  "deadline": "2026-12-31",              // optional ISO date: when old behavior stops
  "languages": ["javascript", "typescript"],
  "changes": [
    {
      "id": "stripe-basil-001",          // stable rule id, unique within spec
      "severity": "breaking",            // breaking | deprecation | behavioral
      "title": "Upcoming invoice endpoints replaced by Create Preview Invoice",
      "description": "…what changed and why…",
      "detect": {
        "patterns": ["invoices\\.retrieveUpcoming", "invoices\\.listUpcomingLines"],  // regex, case-sensitive
        "filePatterns": ["**/*.js", "**/*.ts", "**/*.mjs", "**/*.cjs"],
        "notes": "…hints for the triage/migration agent…"
      },
      "replace": {
        "guidance": "…prose instructions for the migration agent…",
        "before": "const upcoming = await stripe.invoices.retrieveUpcoming({ customer });",
        "after": "const preview = await stripe.invoices.createPreview({ customer });",
        "docsUrl": "https://docs.stripe.com/api/invoices/create_preview"
      }
    }
  ]
}
```

### FR-01.2 Validation
- Loader MUST validate: required fields present, `changes[].id` unique, every `detect.patterns` entry compiles as a JS regex, `severity` in enum.
- Invalid spec → process exits non-zero with each violation listed as `specPath: message`. No partial loading.

### FR-01.3 Sources
- MVP: local file path via `--spec`.
- P1: HTTPS registry fetch with signature verification (design in SYSTEM_DESIGN §8).

---

## FR-02 — Repo Targeting & Git Safety

### FR-02.1 Target resolution
- `--repo <path>` points at a directory. If omitted, CWD.
- Target MUST exist and contain files matching at least one `filePatterns` glob, else exit "nothing to scan."

### FR-02.2 Git safety protocol (hard requirements)
1. If target is a git repo with uncommitted changes → **refuse** to run `migrate` (scan is always allowed) unless `--allow-dirty`.
2. Migration edits happen on a **new branch** `evergreen/<vendor>-<version>` created from current HEAD (suffix `-2`, `-3`… if taken).
3. If target is NOT a git repo → `migrate` requires `--no-git` acknowledgment; edits in place, report only.
4. Evergreen NEVER: force-pushes, deletes branches, amends existing commits, touches hooks, or merges.

### FR-02.3 Scope limits
- Respect `.gitignore` + built-in excludes (`node_modules/`, `dist/`, `build/`, `.git/`, lockfiles, `vendor/`).
- `.evergreen.json` may add `ignore` globs.

---

## FR-03 — Impact Scanner

### FR-03.1 Deterministic pass
- For each change rule: enumerate files matching `detect.filePatterns` (minus excludes), apply each regex per line.
- Output: `Finding[] = { ruleId, file, line, column, matchText, lineText }`.
- Performance: stream files; skip files >1MB and binary files (report as skipped).

### FR-03.2 Triage pass (flag-gated: `--triage`)
- Batch findings (grouped by file, with ±10 lines context) to a cheap model (**Claude Haiku 5.5**) returning per-finding: `verdict: affected|not_affected|uncertain` + one-line reason.
- Engine (v1.1): the triage call runs through the Claude Agent SDK (`query`, model `claude-haiku-5-5`, no tools, single turn) so it shares Claude Code subscription auth; a raw `@anthropic-ai/sdk` Messages path may be added when `ANTHROPIC_API_KEY` deployments matter (hosted workers).
- `uncertain` is treated as `affected` (conservative).
- Triage failures (API error) → fall back to treating all findings as affected; never silently drop findings.

### FR-03.3 Scan report
- Human output: table grouped by rule → file:line.
- `--json`: machine-readable `ScanResult` (schema in SYSTEM_DESIGN §4) written to stdout or `--out <file>`.
- Exit code: `0` findings or clean; `2` on scanner error.

---

## FR-04 — Migration Agent (core)

### FR-04.1 Engine
- Default engine: **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), driving a session whose working directory is the target repo.
- Model: **`claude-opus-5-5`** (correctness-critical; per claude-api guidance this is the default; configurable via `--model` / `.evergreen.json`).
- Allowed tools: file read/edit/write + grep/glob within repo only. **No network tools. No bash in MVP** (re-enabled later only for `verifyCommand`, which the orchestrator runs itself, outside the agent).

### FR-04.2 Input contract (prompt assembly)
The agent receives:
1. The spec (vendor, version, deadline, docs URLs).
2. The scoped rule list with `replace.guidance` + before/after examples.
3. The scanner's findings (file:line per rule) — its authoritative work list.
4. The **minimal-diff contract** (FR-04.3).
5. Required output: a change manifest (FR-04.4) written to a designated path.

### FR-04.3 Minimal-diff contract (prompt-enforced, review-verified)
- Touch ONLY files in the findings list, plus a file that must change as a direct consequence (e.g., a type import) — each such extra file must be justified in the manifest.
- No reformatting, no renames, no refactors, no dependency changes unless a rule mandates a version floor.
- Preserve existing code style per file.
- If a finding cannot be migrated safely (dynamic dispatch, metaprogramming, ambiguous semantics) → leave code untouched, record `skipped` with reason in manifest.
- Preserve whitespace and operator spacing exactly outside the tokens the migration changes; an edit may not alter spacing it did not need to touch. *(added v1.1 after M1 demo produced a cosmetic `-Math.floor` spacing regression)*

### FR-04.4 Change manifest
Agent writes `.evergreen/manifest.json` in the repo:
```jsonc
{
  "specRef": "stripe@2025-03-31.basil",
  "engine": { "model": "claude-opus-5-5" },
  "files": [
    {
      "path": "src/billing.js",
      "rules": ["stripe-basil-001"],
      "status": "migrated",             // migrated | skipped | partial
      "confidence": 0.95,               // 0..1 self-assessed
      "summary": "Replaced retrieveUpcoming with createPreview; mapped params.",
      "reasons": []                      // required when skipped/partial
    }
  ],
  "notes": "anything the reviewer must know"
}
```
- Orchestrator validates the manifest (schema + every findings-file accounted for). Missing/invalid manifest → run marked `failed`, working tree restored (git) — never a silent partial success.

### FR-04.5 Confidence gating
- Per-file confidence < threshold (default **0.8**, `.evergreen.json: confidenceThreshold`) → orchestrator reverts that file (git checkout of the file on the migration branch) and downgrades it to `reported` in the report.
- Overall-run confidence = min of migrated files.

### FR-04.6 Verification hook (flag-gated: `--verify`)
- If `.evergreen.json: verifyCommand` set, orchestrator runs it (shell, in repo root, after migration, on the branch).
- Non-zero exit → recorded in manifest + report; branch still created (reviewer decides); confidence capped at 0.5.

### FR-04.7 Failure modes
| Failure | Behavior |
|---|---|
| Agent session errors / times out (default 15 min) | Restore working tree (git), exit 3, partial manifest preserved under `.evergreen/failed-<ts>.json` |
| Agent edits out-of-scope file | Orchestrator detects via `git status` diff vs. findings; reverts that file; logs violation in report |
| Zero findings | Exit 0, "not affected", no branch |

---

## FR-05 — Delivery (branch / commit / PR)

### FR-05.1 Local delivery (MVP)
- All agent edits land on branch `evergreen/<vendor>-<version>`.
- One commit: `migrate(<vendor>): <version> — <n> files` with spec reference and manifest summary in body.
- Original branch checked out again at the end; working tree clean.

### FR-05.2 Report file
- `MIGRATION_REPORT.md` generated into `.evergreen/` (committed on the branch): spec summary, per-rule → per-file table, before/after snippets for up to 10 representative hunks, confidence, verification results, docs links, review checklist.

### FR-05.3 GitHub PR (P1)
- Via GitHub App token or `gh` CLI when available: push branch, open PR with report as body, label `evergreen`.
- Never enable auto-merge. Never request reviewers automatically (config later).

---

## FR-06 — Reporting
- `evergreen report` re-renders the last manifest as human output.
- `--json` everywhere for machine consumption.
- Telemetry: NONE in MVP (no phoning home). P1 opt-in only.

---

## FR-07 — CLI & Config

### FR-07.1 Commands
```
evergreen scan    --repo <path> --spec <file> [--triage] [--json] [--out <file>]
evergreen migrate --repo <path> --spec <file> [--dry-run] [--triage] [--verify]
                  [--allow-dirty] [--no-git] [--model <id>] [--threshold <0..1>]
evergreen report  --repo <path> [--json]
```
- `--dry-run`: scan + print the migration plan (rules × files + prompt preview), no edits.

### FR-07.2 `.evergreen.json` (repo root, all optional)
```jsonc
{
  "ignore": ["generated/**"],
  "verifyCommand": "npm test",
  "confidenceThreshold": 0.8,
  "model": "claude-opus-5-5"
}
```
Precedence: CLI flag > repo config > defaults.

### FR-07.3 Environment
- Engine auth: Claude Agent SDK resolves credentials per its standard chain (`ANTHROPIC_API_KEY` or Claude Code login). Missing credentials → clear error naming both options, exit 4.

---

## FR-08 — GitHub App Integration (Release 0.3)

### FR-08.1 App identity & installation
- Evergreen registers as a **GitHub App** with these permissions:
  - **Contents: read** — clone/fetch repo files for scanning.
  - **Checks: write** — post Check Run results with per-line annotations.
  - **Pull requests: read** — receive PR events, read PR metadata.
  - **Metadata: read** (default) — repo name, owner, default branch.
- The app subscribes to webhook events: `push`, `pull_request` (opened, synchronize, reopened), `installation`.
- Installation is per-repo or per-org (GitHub standard). No OAuth user flow in 0.3.

### FR-08.2 Webhook server
- An HTTP server (Express) listens for GitHub webhooks on `POST /api/github/webhooks`.
- **Signature verification**: every request verified against `WEBHOOK_SECRET` using `@octokit/webhooks`. Unverified → 401.
- **Health check**: `GET /healthz` returns 200 + `{ status: "ok", specs: <count> }`.
- Server responds 202 to the webhook immediately, processes asynchronously.

### FR-08.3 Remote repo access
- On a scan-triggering event, the server performs a **shallow clone** (`--depth 1`) of the target ref using an installation access token.
- Clone destination: system temp directory, cleaned up after scan.
- Clone uses HTTPS with token auth: `https://x-access-token:<token>@github.com/<owner>/<repo>.git`.
- If clone fails (permissions, network) → log error, post a failed Check Run with a summary, do not retry.

### FR-08.4 Multi-spec scan
- A **spec registry** loads all `*.json` files from the `specs/` directory at server startup.
- Each valid spec is keyed by `specRef` (`vendor@version`).
- On a scan event, the registry's specs are filtered by `languages` field matching the repo's detected language (heuristic: file-extension sampling). If no language filter matches, scan against all specs.
- The existing `scan()` function from `src/scanner/scan.ts` is reused unchanged.
- Each spec that produces findings generates a separate Check Run.

### FR-08.5 Alert delivery — Check Runs
- For each spec with findings, the server creates a **GitHub Check Run** on the target commit SHA:
  - **Name**: `Evergreen: <spec.title>`
  - **Status**: `completed`
  - **Conclusion**: `action_required` (findings found) or `success` (no findings)
  - **Summary**: human-readable table: rule → file:line count, total affected files, migration available indicator.
  - **Annotations** (up to 50 per Check Run, GitHub limit): one per finding, severity mapped to `warning` (breaking/deprecation) or `notice` (behavioral), message includes rule title + guidance snippet.
  - If >50 findings: first 50 as annotations, summary notes the overflow count.
- When a `pull_request` event triggers the scan, the Check Run targets the PR's head SHA, so it appears in the PR's Checks tab.
- Push events target the push's head commit SHA.
- **Never**: auto-merge, request reviewers, close PRs, write to branches, push code, or create Issues (all post-0.3).

### FR-08.6 Configuration
- Server configuration via environment variables:
  - `GITHUB_APP_ID` (required) — the App's numeric ID.
  - `GITHUB_PRIVATE_KEY` (required) — PEM-encoded private key (or path via `GITHUB_PRIVATE_KEY_PATH`).
  - `GITHUB_WEBHOOK_SECRET` (required) — webhook HMAC secret.
  - `PORT` (optional, default 3000) — HTTP listen port.
  - `LOG_LEVEL` (optional, default `info`) — `debug | info | warn | error`.
- Per-repo `.evergreen.json` is respected for `ignore` globs if present in the cloned repo.
- No spec-selection config per repo in 0.3 — all bundled specs are tried.

### FR-08.7 App manifest (creation flow)
- An `app-manifest.json` at project root enables one-click GitHub App creation via `https://github.com/settings/apps/new?manifest=<encoded>`.
- Manifest declares the permissions, events, and webhook URL listed above.
- Setup instructions in README cover: create app → download private key → set env vars → `evergreen serve`.

### FR-08.8 Failure modes
| Failure | Behavior |
|---|---|
| Webhook signature invalid | 401, no processing |
| Clone fails (permissions, timeout) | Failed Check Run with error summary; log |
| Scan throws (malformed repo) | Failed Check Run; log; clean up temp dir |
| Check Run API call fails | Log error; do not retry in 0.3 (add retry queue post-0.3) |
| No specs match repo language | No Check Run created; log at debug level |

---

## Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | Scan of a 5K-file repo completes <30s on a laptop (deterministic pass) |
| NFR-2 | A migration run never leaves the repo in a broken intermediate state (branch isolation + restore-on-failure) |
| NFR-3 | All spec/manifest formats versioned; forward-compatible parsing (ignore unknown fields) |
| NFR-4 | No source code leaves the machine except to the Anthropic API for scoped files; no telemetry in MVP |
| NFR-5 | Windows + macOS + Linux (Node ≥20); paths handled cross-platform |
| NFR-6 | COGS per migration tracked: token usage logged per run into manifest |

---

## Exit Codes
`0` success/clean · `1` validation error (spec/config/CLI) · `2` scanner error · `3` migration failure · `4` auth/credentials missing · `5` git safety refusal
