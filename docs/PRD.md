# Product Requirements Document (PRD)
## Evergreen — Self-Maintaining APIs
**Version:** 1.0 | **Date:** 2026-11-13 | **Status:** Draft — living document
**Doc ID:** PRD | Upstream: [BRD.md](BRD.md) | Downstream: [FSD.md](FSD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md)

---

## 1. Product Vision

> **When an API changes, every codebase that uses it updates itself.**

Evergreen is an agent platform that watches API vendors for breaking changes and keeps every connected codebase compatible — automatically, with reviewable pull requests, before anything breaks in production.

**Positioning:** "Dependabot bumps your dependency version. Evergreen rewrites your code to actually work with it."

**North-star metric:** number of migration PRs **merged** (not opened) per month.

---

## 2. Personas

### P1 — Vendor Platform Owner ("Priya", Platform PM / DevRel lead at an API company) — **the buyer**
- Owns API versioning, deprecation campaigns, integration health.
- Pain: can't sunset old API versions; migration campaigns take years; support tickets spike at every deprecation.
- Wants: dashboard showing % of customers migrated, one-click "launch migration campaign."

### P2 — Consuming Developer ("Dev", engineer at a company that integrates APIs) — **the user**
- Maintains services calling Stripe/Twilio/internal APIs.
- Pain: surprise deprecation emails, archaeology through changelogs, risky hand-migrations.
- Wants: a PR that already did the work, with evidence they can review in 10 minutes. Will reject anything that looks like AI slop.

### P3 — Engineering Lead ("Lena", eng manager at consuming company) — **the gatekeeper**
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

### E1 — Changefeed: Breaking-Change Specification (FR-01)
The machine-readable description of a breaking change set.

- **US-1.1** As a vendor, I can author a `BreakingChangeSpec` (JSON) describing each change: what's deprecated, detection patterns, replacement guidance, examples, docs links, deadline.
  - ✅ AC: Spec validates against published JSON Schema; invalid specs rejected with precise errors.
- **US-1.2** As the system, I can load specs from local files (MVP) and later from a registry/API.
  - ✅ AC: `evergreen migrate --spec <file>` loads and validates.
- **US-1.3 (P1, post-MVP)** As a vendor, I can draft a spec automatically from an OpenAPI diff.

### E2 — Repo Connection & Targeting (FR-02)
- **US-2.1** As a developer, I can point Evergreen at a local repo path (MVP) or install a GitHub App (P1).
  - ✅ AC: MVP works on any local git repo; refuses to run on a dirty working tree unless `--allow-dirty`.
- **US-2.2** As an eng lead, Evergreen runs with least privilege: read for scan; writes only to its own branch.

### E3 — Impact Scanner (FR-03)
- **US-3.1** As a developer, I can run `evergreen scan` and see every location affected by a spec, with file:line and matched rule.
  - ✅ AC: Deterministic pattern pass finds all textual matches; results grouped by rule; zero-match exits cleanly with "not affected."
- **US-3.2** As the system, I triage matches with a cheap LLM pass (Haiku-class) to discard false positives before migration.
  - ✅ AC: Each candidate gets `affected | not_affected | uncertain` with reasoning. (MVP: triage optional, on by flag.)

### E4 — Migration Agent (FR-04) — **the core**
- **US-4.1** As a developer, I can run `evergreen migrate` and get my working tree edited to comply with the spec, scoped only to affected files.
  - ✅ AC: Agent (Claude Opus 5.5 via Claude Agent SDK) edits only files surfaced by the scanner ± imports/tests it must touch; produces a machine-readable change manifest.
- **US-4.2** As a developer, every edit preserves behavior except for the mandated API change — no drive-by refactors.
  - ✅ AC: Diff review shows no unrelated changes; prompt enforces "minimal diff" contract.
- **US-4.3** As the system, I compute a confidence score per file and overall; below threshold → report-only for that file.
  - ✅ AC: Confidence + rationale in the manifest; threshold configurable.
- **US-4.4** As the system, I run the repo's own checks (build/tests if configured) after migration and report results.
  - ✅ AC: Configurable `verifyCommand`; failures downgrade confidence and are reported in the PR body. (MVP: optional.)

### E5 — PR & Delivery (FR-05)
- **US-5.1** As a developer, migrated changes arrive as a branch + commit (MVP: local branch; P1: GitHub PR via App/`gh`).
  - ✅ AC: Branch `evergreen/<vendor>-<version>`; commit message references spec; working tree left clean.
- **US-5.2** As a developer, the PR body explains every change: rule → files → before/after reasoning → docs links → confidence.
  - ✅ AC: Generated `MIGRATION_REPORT.md` + PR body from the change manifest.

### E6 — Reporting & Vendor Analytics (FR-06)
- **US-6.1** As a developer, I get a human-readable migration report per run. (MVP)
- **US-6.2 (P1)** As a vendor, I see aggregate campaign analytics: repos scanned, affected, PRs opened/merged.

### E7 — CLI & Config (FR-07)
- **US-7.1** `evergreen scan|migrate|report` with `--repo`, `--spec`, `--dry-run`, `--triage`, `--verify`, `--json`.
- **US-7.2** Repo-level config file `.evergreen.json` (verify command, ignores, thresholds).

### E8 (P2) — GitHub App, dashboard, changefeed registry, vendor campaign console.

---

## 6. MVP Scope (this build)

**In (P0):**
- Changefeed JSON spec + schema validation (E1: US-1.1, 1.2)
- Local repo targeting with git safety (E2: US-2.1)
- Deterministic scanner (E3: US-3.1)
- Claude-powered migration agent with minimal-diff contract + manifest (E4: US-4.1, 4.2, 4.3)
- Local branch + commit + migration report (E5, E6: US-5.1, 5.2, 6.1)
- CLI (E7)
- **Demo:** fixture repo using real Stripe 2025-03-31 "basil" deprecated patterns, migrated end-to-end.

**Out (P1/P2):** GitHub App & hosted PRs, LLM triage pass (stub behind flag), vendor dashboard, OpenAPI-diff spec authoring, registry, multi-language beyond JS/TS (spec format is language-agnostic by design).

---

## 7. Non-Goals
- **Never auto-merge.** Not even behind a flag.
- Not a general refactoring tool; only vendor-spec-driven migrations.
- Not a dependency updater (Dependabot's job); we handle the *code*, not the lockfile (though specs may require a version floor).
- No proactive scanning of repos we weren't pointed at.

---

## 8. Metrics & KPIs

| Metric | Definition | MVP target | Product target |
|---|---|---|---|
| Scan precision | affected-found / affected-reported | 100% on fixture | >95% real-world |
| Migration correctness | runs passing verify after migration | fixture passes | >90% |
| PR merge rate | merged / opened | n/a | >60% |
| Time-to-migrate | spec publish → PR opened | <10 min | <1 hr at scale |
| COGS per migration | inference + compute | <$2 | <$1.50 blended |

---

## 9. Release Plan
| Release | Contents | Exit criteria |
|---|---|---|
| 0.1 (now) | MVP per §6 | Demo passes on fixture; docs complete |
| 0.2 | LLM triage, verify-command gating, 2nd real changefeed (Twilio or AWS SDK v3) | 2 external alpha repos migrated |
| 0.3 | GitHub App read-only scan + alert | 50 installs |
| 0.4 | Hosted auto-PR, usage billing | first paying team |
| 1.0 | Vendor console + first vendor pilot | signed pilot |

---

## 10. Open Questions
1. Multi-language priority after JS/TS — Python first (largest Stripe usage) or Go?
2. Should the changefeed spec be Apache-2 licensed from day one (ecosystem play) — leaning yes.
3. Confidence scoring: self-reported by agent vs. independent verifier model pass — MVP uses self-report + heuristics, revisit at 0.2.
4. Monorepo scoping strategy for >1M LOC repos (token budgets, path filters).

---

## 11. Traceability
BRD §5 business model ↔ E1/E6 (vendor side), E2–E5 (developer side)
PRD epics → FSD: E1→FR-01, E2→FR-02, E3→FR-03, E4→FR-04, E5→FR-05, E6→FR-06, E7→FR-07
FSD FR-IDs → code: see module map in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) §3.
