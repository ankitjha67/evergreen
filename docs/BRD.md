# Business Requirements Document (BRD)
## Evergreen -- Self-Maintaining APIs
**Version:** 1.0 | **Date:** 2026-11-13 | **Status:** Draft -- living document
**Doc ID:** BRD | Referenced by: [CONTEXT.md](CONTEXT.md), [PRD.md](PRD.md), [FSD.md](FSD.md)

---

## 1. Executive Summary

**Evergreen** makes breaking API changes a non-event. When an API vendor ships a breaking change, Evergreen's AI agents automatically scan every connected customer codebase, generate the exact code migration, and open a ready-to-review pull request -- before the customer's integration ever breaks.

The business model is **vendor-pays (B2B2B)**: API vendors (Stripe, Twilio, payment processors, SaaS platforms) pay Evergreen to keep their customers' integrations perpetually up to date. Vendors get faster deprecation cycles, fewer support tickets, and happier developers; their customers get free, automatic migrations.

This idea is Y Combinator's **Fall 2026 RFS "Self-Maintaining APIs"** (Harsha Gaddipati): *"vendor ships a breaking change -> agent scans customer codebases and opens fix PRs -- 'Dependabot for APIs.'"* Our competitive research (Nov 2026, ~150 searches) found **no venture-funded company** building this exact shape -- ranked #1 of ~107 RFS ideas for openness × feasibility × impact.

---

## 2. Problem Statement

### 2.1 The pain (consumer side)
- Every production software team integrates 10-50+ third-party APIs (payments, auth, comms, shipping, analytics).
- API vendors ship breaking changes constantly: endpoint removals, parameter renames, auth scheme changes, response shape changes, SDK major versions, API version sunsets.
- Each breaking change forces unplanned work: read the changelog, find affected code, rewrite it, test it, ship it -- typically **2-40 engineer-hours per migration per service**.
- Miss a deadline and your integration breaks in production: failed payments, broken logins, dropped webhooks.

### 2.2 The pain (vendor side) -- this is who pays
- Vendors **cannot ship improvements** because deprecations are so expensive: every breaking change triggers months of migration-nag emails, support tickets, and dedicated "migration guides" that customers ignore.
- Vendors run old API versions for **years** (Stripe still serves API versions from 2014+) at enormous maintenance cost, purely because customers won't migrate.
- Deprecation campaigns are run with spreadsheets, email blasts, and customer success calls. There is no product for this.
- A vendor that could deprecate in 3 months instead of 3 years ships faster than every competitor.

### 2.3 Why now
1. **LLM coding agents crossed the capability threshold** -- Claude-class models reliably perform mechanical-to-moderate code migrations with verifiable diffs.
2. **Agent cost collapsed** -- a full repo migration costs ~$1-3 of inference (Claude Opus 5.5 at $4/$20 per MTok), vs. $500-$5,000 of engineer time.
3. **YC publicly named the category** (Fall 2026 RFS) -- a demand signal and a starting gun; the window for category leadership is ~12-24 months.
4. **Precedent is proven adjacent**: Dependabot (acquired by GitHub) proved automated fix-PRs are an accepted workflow; developers merge bot PRs daily.

---

## 3. Market Analysis

### 3.1 TAM / SAM / SOM
| Layer | Definition | Size (est.) |
|---|---|---|
| TAM | API management ($6B+) + developer tools ($30B+) + share of vendor developer-experience/support spend | $8-12B relevant spend |
| SAM | API vendors with public APIs + >1,000 integrating customers + active deprecation cycles (≈5,000 companies globally) | $1.5-2.5B |
| SOM (3yr) | 50-150 paying vendors + developer-side subscriptions | $10-40M ARR |

### 3.2 Market structure
- **Buyers (primary):** API platform vendors -- DevRel leads, Platform PMs, VP Engineering. Budget exists today under "developer experience," "API platform," and "support deflection."
- **Users (secondary):** developers at consuming companies -- they receive the PRs. Their experience drives vendor renewal.
- **Wedge market:** fintech/payments APIs (Stripe-ecosystem, PSPs, banking-as-a-service) -- highest breaking-change frequency, highest cost of breakage, most formalized API versioning.

### 3.3 Demand evidence
- Stripe's 2025 "basil" release (2025-03-31) introduced sweeping breaking changes (invoice preview endpoints replaced, subscription period fields moved) -> thousands of teams forced to migrate.
- Vendors publish elaborate migration guides (Stripe, Twilio, Shopify, Plaid) -- evidence they spend heavily on a problem they can't solve with docs.
- GitHub Dependabot/Renovate adoption proves bots-opening-PRs is a normalized, trusted workflow.

---

## 4. Competitive Landscape (researched Nov 2026)

| Player | Funding | What they do | Why they don't solve this |
|---|---|---|---|
| Dependabot (GitHub) / Renovate (Mend) | Platform features | Dependency **version bumps** | Bump `stripe` 14->17 but don't rewrite your code to the new API -- the PR often *breaks* the build |
| Infield | YC W20, ~$3M | Dependency-upgrade service (human+tool) | Consumer-side, service-heavy, dependency-focused, not vendor-triggered |
| Codemod / Moderne | Seed-B | Large-scale code transformation platforms | Enterprise internal-migration focus; rule-authoring heavy; not vendor-pays, not API-change-triggered |
| OSS/indie (ApiPatch, Mendapi, Ripple, Flash Patch, Kinet) | Unfunded | Prototypes of exactly this idea | Signal the wave is coming; none has distribution, funding, or vendor relationships |
| Stainless / Speakeasy / Fern | Seed-A | SDK **generation** for API vendors | Generate the SDK; don't touch customer code. **Natural partners or acquirers** |

**Key gap we occupy:** *vendor-paid, vendor-triggered, semantic migration of customer application code.* Nobody does all three.

**Competitive risks:** (see §9) GitHub/Microsoft absorbing it into Copilot/Dependabot; SDK-gen players (Stainless/Speakeasy) expanding forward into customer code.

---

## 5. Business Model

### 5.1 Primary: Vendor-pays platform (B2B2B)
Vendors subscribe to Evergreen and offer it to their integration customers as "auto-migration" -- a feature of the vendor's platform.

| Tier | Target vendor | Price (annual) | Includes |
|---|---|---|---|
| Launch | API startups (<1K integrators) | $12K | 1 API surface, 500 connected repos, changefeed authoring tools |
| Growth | Mid-size platforms | $48K | 3 API surfaces, 5K repos, migration analytics, SLA |
| Enterprise | Stripe/Twilio-class | $150K-$500K+ | Unlimited surfaces, dedicated migration engineering, custom validation, on-prem scanning option |

Plus **usage component**: $0.25-$1.00 per successfully merged migration PR (aligned with value delivered).

### 5.2 Secondary: Developer/team subscription (consumer side)
Teams connect their repos and get coverage across **all** their API vendors (including ones who don't pay us):
- Free: 1 repo, scan + alert only (no auto-PR) -> acquisition channel and vendor-side demand proof
- Team: $29/repo/mo -- auto-PRs for supported changefeeds
- This side builds the repo graph that makes the vendor pitch stronger ("we already watch 40,000 repos that call your API").

### 5.3 Unit economics (per migration PR)
| Cost item | Estimate |
|---|---|
| Inference (Claude Opus 5.5: ~200K in / 20K out per repo) | ~$1.20 |
| Triage scan (Claude Haiku 5.5, $0.10/$0.50 per MTok) | ~$0.02 |
| Compute/orchestration | ~$0.10 |
| **COGS per PR** | **~$1.35** |
| Revenue per merged PR (blended) | $5-25 |
| **Gross margin** | **75-90%** |

### 5.4 Why vendor-pays wins
- Vendor budget is 100-1000× bigger than per-developer budget for this problem.
- One vendor contract = thousands of covered repos = instant distribution.
- The alternative (dev-pays) is a crowded, low-ACV motion; vendor-pays has **zero** competitors.

---

## 6. Go-To-Market

### Phase 0 (months 0-3): Prove the loop
- Working demo: Stripe "basil" breaking changes -> scan -> migrate -> PR, end-to-end. <-- **current milestone (MVP in this repo)**
- Publish OSS changefeed spec format; seed specs for 3 real migrations (Stripe basil, Twilio, Node 18 AWS SDK v2->v3).

### Phase 1 (months 3-9): Consumer-side wedge (free)
- GitHub App: free breaking-change alerts + paid auto-PRs. Target: 1,000 connected repos.
- Every PR footer: "Migrated automatically by Evergreen" -> developer-led growth.

### Phase 2 (months 6-18): First vendor contracts
- Pitch 20 mid-size API vendors (fintech infra, comms, logistics APIs) with data from Phase 1: "X of your customers are on deprecated endpoints; we can migrate them this week."
- Land 3-5 Launch-tier logos; co-announce "auto-migration" as their feature.

### Phase 3 (18+ months): Platform
- Changefeed authoring suite for vendor API teams (auto-generate specs from OpenAPI diffs).
- Marketplace of verified changefeeds; SLA-backed enterprise deprecation campaigns.

---

## 7. Revenue Projections (scenario, not forecast)

| Year | Conservative | Base | Aggressive |
|---|---|---|---|
| Y1 | $60K (pilots) | $150K | $400K |
| Y2 | $500K | $1.2M | $3M |
| Y3 | $2M | $6M | $15M |

Drivers: vendor logos × tier mix + merged-PR usage fees + team subscriptions.

---

## 8. Success Criteria (business)

| Milestone | Target | Measure |
|---|---|---|
| M1: Technical proof | MVP migrates a real Stripe breaking change end-to-end with a correct diff | Demo in this repo |
| M2: Developer trust | ≥60% of auto-PRs merged without modification | PR telemetry |
| M3: Consumer traction | 1,000 connected repos | GitHub App installs |
| M4: Vendor validation | 3 signed vendor pilots | Contracts |
| M5: Revenue | $150K ARR by month 18 | Billing |

---

## 9. Risks & Mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | GitHub absorbs this into Dependabot+Copilot | Med | High | Move fast on the **vendor-pays** side GitHub won't build (vendor contracts, changefeed authoring, deprecation campaign tooling); be acquirable |
| R2 | Repo-access trust barrier ("an AI edits our code?") | High | Med | Read-only scan by default; PRs never auto-merge; signed provenance on every diff; SOC 2 early; on-prem scanner for enterprise |
| R3 | Migration quality -- a wrong diff destroys trust instantly | Med | High | Confidence scoring; run customer test suites in CI before PR; conservative "alert-only" fallback below confidence threshold; human review always required |
| R4 | Vendors slow to buy (new budget line) | Med | Med | Consumer-side free tier generates vendor-side pull ("your customers already use us") |
| R5 | Inference cost spikes on huge monorepos | Low | Low | Haiku triage pass narrows scope before Opus migration pass; per-repo token budgets |
| R6 | Stainless/Speakeasy expand into customer-code migration | Med | Med | Partner early (their SDK diffs are our changefeed input); vendor relationships are the moat |

---

## 10. Stakeholders & Decision Log Pointer
- Founder/builder: ankitjha67@gmail.com's project (this repo)
- Build approach, decisions, and progress: see [CONTEXT.md](CONTEXT.md) (single source of truth for current state)
- Requirements traceability: BRD §objectives -> PRD epics -> FSD FR-IDs -> code modules

---

## 11. References
- YC RFS Fall 2026 -- "Self-Maintaining APIs" (Harsha Gaddipati): ycombinator.com/rfs
- Competitive research: [../../yc-rfs-complete-deep-dive-ranked.md](../../yc-rfs-complete-deep-dive-ranked.md) (#1 ranked idea)
- Stripe 2025-03-31 "basil" breaking changes (demo migration target): stripe.com/docs/upgrades
