# Product Requirements Document (PRD)
## Evergreen -- Self-Maintaining APIs
**Version:** 2.0 | **Date:** 2026-11-14 | **Status:** Active -- living document
**Doc ID:** PRD | Upstream: [BRD.md](BRD.md) | Downstream: [FSD.md](FSD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)

---

## 1. Product Vision

> **When an API changes, every codebase that uses it updates itself.**

Evergreen is an agent platform that watches API vendors for breaking changes and keeps every connected codebase compatible -- automatically, with reviewable pull requests, before anything breaks in production.

**Positioning:** "Dependabot bumps your dependency version. Evergreen rewrites your code to actually work with it."

**North-star metric:** number of migration PRs **merged** (not opened) per month.

---

## 2. Personas

### P1 -- Vendor Platform Owner ("Priya", Platform PM / DevRel lead at an API company) -- **the buyer**
- Owns API versioning, deprecation campaigns, integration health.
- Pain: can't sunset old API versions; migration campaigns take years; support tickets spike at every deprecation.
- Wants: dashboard showing % of customers migrated, one-click "launch migration campaign."

### P2 -- Consuming Developer ("Dev", engineer at a company that integrates APIs) -- **the user**
- Maintains services calling Stripe/Twilio/internal APIs.
- Pain: surprise deprecation emails, archaeology through changelogs, risky hand-migrations.
- Wants: a PR that already did the work, with evidence they can review in 10 minutes. Will reject anything that looks like AI slop.

### P3 -- Engineering Lead ("Lena", eng manager at consuming company) -- **the gatekeeper**
- Approves tooling with repo access.
- Wants: least-privilege access, audit logs, no auto-merge, provable diff provenance.

---

## 3. Jobs To Be Done

| ID | Persona | Job |
|---|---|---|
| J1 | P1 | *When I ship a breaking change, migrate my customers for me so I can sunset old versions in months, not years.* |
| J2 | P1 | *Show me which customers are on deprecated usage so I can measure campaign progress.* |
| J3 | P2 | *When an API I use changes, hand me a correct, tested, reviewable PR before the deadline.* |
| J4 | P2 | *Tell me if I'm affected at all, so I can stop reading changelogs.* |
| J5 | P3 | *Let me adopt this without granting scary permissions or losing control of what merges.* |

---

## 4. Product Principles

1. **PRs, never pushes.** Evergreen only ever opens pull requests. A human merges. No exceptions.
2. **Evidence over vibes.** Every change in a PR cites the changefeed rule and vendor doc that motivated it.
3. **Confidence-gated.** Below the confidence threshold, Evergreen alerts instead of editing. A wrong diff costs more trust than ten missed ones.
4. **Deterministic first, agent second.** Cheap deterministic scanning narrows scope; the LLM agent only touches what matters.
5. **Vendor-neutral spec.** The changefeed format is open; anyone can author one. The platform, distribution, and quality are the moat.

---

## 5. Feature Epics, User Stories & Acceptance Criteria

> FR-IDs referenced here are specified in detail in [FSD.md](FSD.md).

### E1 -- Changefeed: Breaking-Change Specification (FR-01)
The machine-readable description of a breaking change set.

- **US-1.1** As a vendor, I can author a `BreakingChangeSpec` (JSON) describing each change: what's deprecated, detection patterns, replacement guidance, examples, docs links, deadline.
  - ✅ AC: Spec validates against published JSON Schema; invalid specs rejected with precise errors.
  - ✅ `evergreen validate` CLI validates spec files with structured output.
- **US-1.2** As the system, I can load specs from local files, remote URLs, or a registry.
  - ✅ AC: `evergreen migrate --spec <file>` loads and validates.
  - ✅ `evergreen fetch-spec` downloads specs from HTTP(S) URLs.
  - ✅ `evergreen fetch-registry` downloads from registry index with `--lang`/`--vendor` filters.
- **US-1.3** As a vendor, I can draft a spec automatically from an OpenAPI diff.
  - ✅ AC: `evergreen openapi-diff` compares two OpenAPI schemas, detects removed paths/methods/params/responses, generates a valid `BreakingChangeSpec`.
- **US-1.4** As a vendor, I can start from a pre-built template for common API migrations.
  - ✅ AC: 6 templates (Stripe, OpenAI, AWS SDK, Firebase, React, Prisma). `evergreen templates` lists with filters; `evergreen from-template <id> --version <ver>` instantiates.
- **US-1.5** As the system, I verify spec integrity via SHA-256 checksums.
  - ✅ AC: `evergreen verify-specs` checks against manifest; `--generate` creates checksums.json.
- **US-1.6** As a vendor, I can create specs via a guided wizard with validation.
  - ✅ AC: `evergreen create-spec` with `--vendor`, `--api`, `--version`, regex validation, language-aware file patterns.
- **US-1.7** As a developer, I can compare two spec versions to see what changed.
  - ✅ AC: `evergreen spec-diff` shows added/removed/changed rules plus metadata changes.

### E2 -- Repo Connection & Targeting (FR-02)
- **US-2.1** As a developer, I can point Evergreen at a local repo path or install a GitHub App.
  - ✅ AC: Local git repo (refuses dirty working tree unless `--allow-dirty`).
  - ✅ AC: GitHub App (App ID 5745187) with webhook-driven scan on push/PR events.
  - ✅ AC: Shallow clone via installation tokens for GitHub App repos.
- **US-2.2** As an eng lead, Evergreen runs with least privilege: read for scan; writes only to its own branch.
  - ✅ AC: GitHub App permissions: Checks read+write, Contents read-only, Metadata read-only.
- **US-2.3** As a developer, I can scope scans to specific paths in a monorepo.
  - ✅ AC: `--scope <paths>` flag on scan/migrate/scan-all/diff/estimate commands. Configurable via `.evergreen.json`/`.evergreen.yaml`.

### E3 -- Impact Scanner (FR-03)
- **US-3.1** As a developer, I can run `evergreen scan` and see every location affected by a spec, with file:line and matched rule.
  - ✅ AC: Deterministic pattern pass finds all textual matches; results grouped by rule; zero-match exits cleanly with "not affected."
  - ✅ `evergreen scan-all` scans against ALL bundled specs concurrently.
  - ✅ `evergreen diff` previews migration with file grouping and before/after snippets.
- **US-3.2** As the system, I triage matches with a cheap LLM pass (Haiku-class) to discard false positives before migration.
  - ✅ AC: Each candidate gets `affected | not_affected | uncertain` with reasoning. Verified live: Haiku flagged 9/9 real sites, discarded the decoy.
- **US-3.3** As a developer, I can scan multiple repos at once from a manifest.
  - ✅ AC: `evergreen batch-scan` with JSON/text manifests, configurable concurrency (up to 8).

### E4 -- Migration Agent (FR-04) -- **the core**
- **US-4.1** As a developer, I can run `evergreen migrate` and get my working tree edited to comply with the spec, scoped only to affected files.
  - ✅ AC: Agent (Claude Opus 5.5 via Claude Agent SDK) edits only files surfaced by the scanner; produces a machine-readable change manifest.
  - ✅ AC: Provider-agnostic agent loop supports 15 LLM providers via `--provider` flag.
- **US-4.2** As a developer, every edit preserves behavior except for the mandated API change -- no drive-by refactors.
  - ✅ AC: Diff review shows no unrelated changes; prompt enforces "minimal diff" contract.
- **US-4.3** As the system, I compute a confidence score per file and overall; below threshold -> report-only for that file.
  - ✅ AC: Confidence + rationale in the manifest; threshold configurable.
- **US-4.4** As the system, I run the repo's own checks (build/tests if configured) after migration and report results.
  - ✅ AC: Configurable `verifyCommand`; failures downgrade confidence and are reported.
- **US-4.5** As a developer, I can roll back a migration by deleting the evergreen branch.
  - ✅ AC: `evergreen rollback [branch]` lists or deletes `evergreen/*` branches.
- **US-4.6** As a developer, I can estimate migration cost before running it.
  - ✅ AC: `evergreen estimate` calculates token counts and USD cost per model.
  - ✅ AC: `evergreen cost-compare` compares costs across 9 models with tabular output.

### E5 -- PR & Delivery (FR-05)
- **US-5.1** As a developer, migrated changes arrive as a branch + commit or a GitHub PR.
  - ✅ AC: Branch `evergreen/<vendor>-<version>`; commit message references spec; working tree left clean.
  - ✅ AC: Auto-PR on webhook: scan -> migrate -> push branch -> open PR -> update Check Run. Gated by `AUTO_MIGRATE=true`.
- **US-5.2** As a developer, the PR body explains every change: rule -> files -> before/after reasoning -> docs links -> confidence.
  - ✅ AC: Generated `MIGRATION_REPORT.md` + PR body from the change manifest.

### E6 -- Reporting & Vendor Analytics (FR-06)
- **US-6.1** As a developer, I get a human-readable migration report per run.
  - ✅ AC: Migration report committed to branch. `evergreen report` CLI.
- **US-6.2** As a vendor, I see aggregate campaign analytics: repos scanned, affected, PRs opened/merged.
  - ✅ AC: `GET /api/campaigns` endpoint with `?vendor=` filter. Usage tracking to `data/usage.jsonl`.
- **US-6.3** As a developer, I can export scan results, migration history, or findings as CSV or JSON.
  - ✅ AC: `evergreen export history|scan|findings --format csv|json` with filtering and file output.
- **US-6.4** As a developer, I can query my migration history with stats.
  - ✅ AC: `evergreen history` with `--repo`/`--spec`/`--status`/`--since` filters, success rate, cost/confidence aggregation.
- **US-6.5** As a developer, I get notified about scan results and migrations via Slack or webhooks.
  - ✅ AC: `SLACK_WEBHOOK_URL`/`NOTIFY_WEBHOOK_URL` env vars. Slack rich blocks, generic webhooks, console output. `evergreen notify` for testing.

### E7 -- CLI & Config (FR-07)
- **US-7.1** Full CLI with 28 commands: `scan`, `migrate`, `report`, `serve`, `providers`, `estimate`, `validate`, `diff`, `fetch-spec`, `specs`, `scan-all`, `batch-scan`, `openapi-diff`, `verify-specs`, `create-spec`, `history`, `notify`, `fetch-registry`, `doctor`, `export`, `spec-diff`, `rollback`, `templates`, `from-template`, `cost-compare`, `init`, `usage`.
- **US-7.2** Repo-level config via `.evergreen.json` or `.evergreen.yaml` (verify command, ignores, thresholds, scope, provider, fallback chain, token limits).
- **US-7.3** `evergreen doctor` validates environment health: Node version, repo config, specs dir, provider auth, git repo, spec integrity.

### E8 -- GitHub App & Server (FR-08)
- **US-8.1** GitHub App server with Express + `@octokit/webhooks` for webhook signature verification.
  - ✅ AC: Real app registered (App ID 5745187, "Evergreen API Scanner"). End-to-end webhook flow verified on live repo.
- **US-8.2** Webhook handlers for push (default-branch only), pull_request (opened/sync/reopen), installation events.
  - ✅ AC: Check Run alerts with inline annotations per finding, 50-batch limit, summary table, deadline.
- **US-8.3** Admin dashboard with server status, loaded specs, webhook event history, usage stats.
  - ✅ AC: `GET /admin` full-featured HTML dashboard. Specs API, Events API, Usage API.
- **US-8.4** Spec hot-reload: file watcher triggers automatic reload without server restart.
- **US-8.5** Webhook retry queue with exponential backoff and dead-letter queue.

### E9 -- Multi-LLM Provider Support (FR-09)
- **US-9.1** As a developer, I can choose from 15 LLM providers for migration.
  - ✅ AC: Anthropic, OpenAI, Google Gemini + 12 OpenAI-compatible (Ollama, NIM, Groq, Together AI, Fireworks AI, DeepSeek, Mistral, Perplexity, Anyscale, Azure OpenAI, OpenRouter, LM Studio, vLLM).
- **US-9.2** Dynamic model discovery via API with cross-provider fallback chain.
  - ✅ AC: `--fallback <ids>` CLI flag, `fallback:` in config, `MIGRATION_FALLBACK_PROVIDERS` env var.
- **US-9.3** `evergreen providers` with `--discover` for live model lists.

### E10 -- Multi-Language Support
- **US-10.1** Scanner supports JS/TS, Python, Ruby, and Go with language-specific file patterns.
  - ✅ AC: 5 bundled Stripe specs across 4 languages. Fixture repos for each.
  - ✅ AC: 6 spec templates covering additional vendor ecosystems.

---

## 6. Scope & Current State

**Shipped (as of 2026-11-14):**
- Changefeed JSON spec + schema validation + spec wizard + templates + OpenAPI diff generator + integrity verification (E1)
- Local repo targeting + GitHub App (real, registered, e2e verified) + monorepo scoping (E2)
- Deterministic scanner + LLM triage + batch scanning + diff preview (E3)
- Claude-powered migration agent + 15 LLM providers + dynamic model discovery + fallback chain + cost estimation + rollback (E4)
- Local branch + commit + auto-PR on webhook + Check Run alerts (E5)
- Migration report + vendor campaign analytics + export + history + notifications (E6)
- 28 CLI commands + `.evergreen.json`/`.evergreen.yaml` config + doctor (E7)
- GitHub App server + admin dashboard + webhooks + retry queue + hot-reload (E8)
- Multi-LLM: 15 providers + discovery + fallback (E9)
- Multi-language: JS/TS, Python, Ruby, Go + 6 vendor templates (E10)
- **279 tests across 38 suites. Verified end-to-end on live GitHub repos.**
- **Docker-ready** with multi-stage build, Railway/Render deployment configs.

**Next (P2):**
- Vendor self-service portal and marketplace listing
- Billing integration and usage-based pricing
- Hosted deployment (Railway/Render with persistent webhook URL)
- Changefeed spec registry service (public API)
- Additional language support (Java, PHP, C#)

---

## 7. Non-Goals
- **Never auto-merge.** Not even behind a flag.
- Not a general refactoring tool; only vendor-spec-driven migrations.
- Not a dependency updater (Dependabot's job); we handle the *code*, not the lockfile (though specs may require a version floor).
- No proactive scanning of repos we weren't pointed at.

---

## 8. Metrics & KPIs

| Metric | Definition | MVP target | Actual | Product target |
|---|---|---|---|---|
| Scan precision | affected-found / affected-reported | 100% on fixture | ✅ 100% on fixtures (7/7 sites found, 0 false negatives) | >95% real-world |
| Migration correctness | runs passing verify after migration | fixture passes | ✅ Fixture passes. Live triage: 9/9 correct + decoy rejected | >90% |
| PR merge rate | merged / opened | n/a | n/a (pre-deployment) | >60% |
| Time-to-migrate | spec publish -> PR opened | <10 min | ✅ ~2 min (webhook -> scan -> PR on live repo) | <1 hr at scale |
| COGS per migration | inference + compute | <$2 | ✅ $0.26 migration + $0.20 triage (Stripe demo) | <$1.50 blended |
| Test coverage | tests passing | >50 | ✅ 279 tests across 38 suites | >90% line coverage |
| CLI commands | functional commands shipped | 3 (scan/migrate/report) | ✅ 28 commands | -- |
| LLM providers | supported providers | 1 (Anthropic) | ✅ 15 providers with fallback chain | -- |
| Languages | programming languages supported | 1 (JS/TS) | ✅ 4 (JS/TS, Python, Ruby, Go) + 6 templates | 8+ |

---

## 9. Release Plan
| Release | Contents | Status |
|---|---|---|
| 0.1 | MVP: spec loader, scanner, migration agent, branch delivery, CLI | ✅ 2026-11-13 |
| 0.2 | LLM triage, verify-command gating, 2nd changefeed (OpenAI v4), cost accounting | ✅ 2026-11-13 |
| 0.3 | GitHub App server, Check Run alerts, webhook handlers, shallow clone | ✅ 2026-11-13. Real GitHub App registered + e2e verified |
| 0.4 | Multi-LLM (15 providers), auto-PR on webhook, Dockerfile, usage tracking | ✅ 2026-11-13 |
| 0.5 | Production-readiness: graceful shutdown, rate limiting, request logging, usage CLI | ✅ 2026-11-13 |
| 0.6 | Admin dashboard, specs/events API, event log, spec hot-reload | ✅ 2026-11-13 |
| 0.7 | Python support, validate CLI, YAML config, spec-ref collision fix | ✅ 2026-11-13 |
| 0.8 | CI/CD, diff preview, spec fetch, structured logger | ✅ 2026-11-13 |
| 0.9 | Multi-spec scan, retry queue, specs CLI | ✅ 2026-11-13 |
| 0.9+ | Dynamic model discovery, Ruby/Go support, spec registry, campaign analytics, cost estimation, batch scanning, OpenAPI diff, spec integrity, monorepo scoping, notifications, spec wizard, migration history, spec diff, doctor, export, rollback, templates, cost-compare | ✅ 2026-11-14. 279 tests, 28 CLI commands |
| 1.0 | Vendor self-service portal + first vendor pilot | Next: deployment + pilot |

---

## 10. Open Questions
1. ~~Multi-language priority after JS/TS -- Python first or Go?~~ **RESOLVED**: Both added. Python (Session 7), Ruby + Go (Session 12). 5 bundled specs across 4 languages + 6 vendor templates.
2. Should the changefeed spec be Apache-2 licensed from day one (ecosystem play) -- leaning yes.
3. ~~Confidence scoring: self-reported by agent vs. independent verifier model pass.~~ **Partial**: MVP uses self-report + heuristics + configurable verify command. Independent verifier still deferred.
4. ~~Monorepo scoping strategy for >1M LOC repos.~~ **RESOLVED**: `--scope <paths>` flag + `.evergreen.yaml` config (Session 14). Path-prefix glob restriction.

---

## 11. Traceability
BRD §5 business model <-> E1/E6 (vendor side), E2-E5 (developer side)
PRD epics -> FSD: E1->FR-01, E2->FR-02, E3->FR-03, E4->FR-04, E5->FR-05, E6->FR-06, E7->FR-07, E8->FR-08, E9->FR-09, E10->multi-lang
FSD FR-IDs -> code: see module map in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) §3.

## 12. Implementation Summary (as of 2026-11-14)

| Area | Module(s) | Key functions |
|---|---|---|
| Spec loading | `src/changefeed/loader.ts` | `loadSpec()`, `validateSpec()` |
| Spec authoring | `src/create-spec.ts` | `buildSpec()`, `validateWizardInput()` |
| Spec templates | `src/templates.ts` | `listTemplates()`, `instantiateTemplate()` |
| Spec diff | `src/spec-diff.ts` | `diffSpecs()`, `formatSpecDiff()` |
| Spec integrity | `src/changefeed/integrity.ts` | `verifySpecs()`, `generateChecksumManifest()` |
| OpenAPI diff | `src/changefeed/openapi-diff.ts` | `generateSpecFromDiff()` |
| Registry | `src/changefeed/registry-index.ts` | `fetchRegistryIndex()`, `fetchFromIndex()` |
| Git safety | `src/git.ts` | `isCleanTree()`, `createBranch()`, `restoreFiles()` |
| Scanner | `src/scanner.ts` | `scan()`, `Finding` type |
| Triage | `src/triage.ts` | `triageFindings()` (Haiku-class LLM) |
| Migration agent | `src/migrator/agent.ts` | `runMigrationAgent()`, `runProviderMigration()` |
| Orchestrator | `src/orchestrator.ts` | `runMigration()` (scan -> triage -> agent -> verify -> deliver) |
| Cost estimation | `src/estimate.ts` | `estimateMigrationCost()` |
| Cost comparison | `src/cost-compare.ts` | `compareCosts()`, `formatCostComparison()` |
| Batch scanning | `src/batch.ts` | `batchScan()`, `loadManifest()` |
| Rollback | `src/rollback.ts` | `rollbackMigration()`, `listMigrationBranches()` |
| Export | `src/export.ts` | `exportData()` (CSV/JSON) |
| History | `src/history.ts` | `logHistory()`, `queryHistory()` |
| Notifications | `src/notifications.ts` | `sendNotification()`, `notifyAll()` |
| Doctor | `src/doctor.ts` | `runDoctor()`, `formatDoctorReport()` |
| Providers | `src/providers/*.ts` | 15 providers, `LLMProvider` interface |
| Discovery | `src/providers/discovery.ts` | `discoverModels()`, `selectBestModel()` |
| Fallback | `src/providers/fallback.ts` | `FallbackProvider`, `buildFallbackChain()` |
| GitHub App | `src/server/app.ts` | Express server, webhook handlers |
| Check Runs | `src/github/checks.ts` | `createCheckRun()` with annotations |
| Dashboard | `src/server/dashboard.ts` | `GET /admin` HTML dashboard |
| Campaigns | `src/server/campaigns.ts` | `buildCampaignStats()`, `GET /api/campaigns` |
| CLI | `src/cli.ts` | 28 commands via commander |
| Config | `src/config.ts` | `.evergreen.json`/`.evergreen.yaml` loading |
| Logger | `src/logger.ts` | Leveled logging with JSON mode |
