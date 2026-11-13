# Evergreen

**Self-maintaining APIs.** When an API vendor ships a breaking change, Evergreen scans every connected codebase, rewrites only the affected code, and delivers it as a reviewable branch with an evidence report — before anything breaks in production.

> Dependabot bumps your dependency version. **Evergreen rewrites your code to actually work with it.**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-25%20passing-brightgreen)](tests/)
[![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)]()

Origin: YC Fall 2026 RFS "Self-Maintaining APIs" — ranked #1 of 107 RFS ideas in our competitive study (zero funded competition, Nov 2026).

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [CLI Usage](#cli-usage)
  - [Running Demos](#running-demos)
- [GitHub App Setup](#github-app-setup)
  - [Register the App](#register-the-app)
  - [Configure Environment](#configure-environment)
  - [Start the Server](#start-the-server)
  - [Local Development with smee.io](#local-development-with-smeeio)
- [Changefeed Specs](#changefeed-specs)
  - [Bundled Specs](#bundled-specs)
  - [Writing Your Own Spec](#writing-your-own-spec)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Safety & Trust Model](#safety--trust-model)
- [Roadmap](#roadmap)
- [Documentation](#documentation)
- [Contributing](#contributing)

---

## How It Works

```
Vendor publishes spec ──> Evergreen scans repos ──> Agent migrates code ──> PR delivered for review
```

1. **Changefeed** — A vendor publishes a `BreakingChangeSpec` (open JSON format). Each spec declares rules with regex patterns, affected API versions, migration guidance, and deadlines. See [`specs/`](specs/) for examples.

2. **Scan** — A deterministic regex-based scanner finds every affected `file:line` across the codebase. No AI involved — cheap, fast (~17ms for a typical repo), and fully auditable.

3. **Triage** *(optional)* — Claude Haiku 5.5 classifies each finding as `affected`, `not_affected`, or `needs_review`, filtering out false positives before the expensive migration step (~$0.20/run).

4. **Migrate** — Claude Opus 5.5 (via Claude Agent SDK) edits *only* the affected files under a strict **minimal-diff contract**: no reformatting, no unrelated changes, no new dependencies unless justified. Every edited file gets a per-file confidence score.

5. **Enforce** — The orchestrator reverts any out-of-scope edits and files below the confidence threshold (default: 0.80). Optional verify command (e.g., `node --check`) gates delivery.

6. **Deliver** — One atomic commit on an isolated `evergreen/<vendor>-<version>` branch, plus a `MIGRATION_REPORT.md` with full evidence. PRs only, never pushes. A human reviews and merges.

### GitHub App Mode (Release 0.3)

When installed as a GitHub App, Evergreen runs automatically:

```
Push/PR on GitHub ──> Webhook ──> Shallow clone ──> Scan all specs ──> Check Run with annotations
```

- Receives push and pull request webhooks
- Shallow-clones the repo using installation tokens
- Scans against all bundled changefeed specs
- Posts findings as **GitHub Check Run annotations** on the exact affected lines
- Shows a summary table with rules, file counts, migration deadline, and a CTA to run the migration CLI

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     CLI (commander)                     │
│              scan · migrate · report · serve            │
└────────┬──────────┬──────────┬──────────┬───────────────┘
         │          │          │          │
    ┌────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌───▼──────────────┐
    │ Loader │ │Scanner │ │Migrate │ │  GitHub App      │
    │ FR-01  │ │FR-03.1 │ │ FR-04  │ │  Server (FR-08)  │
    └────┬───┘ └────┬───┘ └───┬────┘ └───┬──────────────┘
         │          │         │           │
    specs/*.json    │    Claude Opus 5.5  │
                    │    (Agent SDK)      │
              ┌─────▼─────┐         ┌────▼──────────┐
              │  Triage   │         │ Webhooks      │
              │  FR-03.2  │         │ Check Runs    │
              │ Haiku 5.5 │         │ Shallow Clone │
              └───────────┘         └───────────────┘
```

| Component | Module | Purpose |
|---|---|---|
| Changefeed Loader | `src/changefeed/loader.ts` | Validates and loads `BreakingChangeSpec` JSON |
| Scanner | `src/scanner/scan.ts` | Deterministic regex scan → `{file, line, rule}` findings |
| Triage | `src/triage/triage.ts` | Haiku 5.5 classifies findings (affected / not_affected / needs_review) |
| Migration Agent | `src/migrator/agent.ts` | Opus 5.5 via Claude Agent SDK, minimal-diff contract |
| Prompt Builder | `src/migrator/prompt.ts` | Constructs the migration prompt from spec + findings |
| Git Safety | `src/repo/git.ts` | Branch isolation, dirty-tree checks, restore-on-failure |
| Report Generator | `src/report/report.ts` | Generates `MIGRATION_REPORT.md` with evidence |
| Orchestrator | `src/orchestrator.ts` | Wires scan → triage → migrate → enforce → deliver |
| Spec Registry | `src/registry/specs.ts` | Loads all bundled specs, filters by language |
| GitHub Client | `src/github/client.ts` | App JWT → installation token auth chain |
| Shallow Clone | `src/github/clone.ts` | `git clone --depth 1` with installation token |
| Check Runs | `src/github/checks.ts` | Creates Check Runs with per-line annotations |
| Webhook Server | `src/server/app.ts` | Express + HMAC-SHA256 webhook signature verification |
| Webhook Handlers | `src/server/webhooks.ts` | push/PR/installation event processing |
| CLI | `src/cli.ts` | Commander-based CLI: scan, migrate, report, serve |

---

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **npm** (comes with Node.js)
- **Git** (for migration branch delivery)
- **Claude Code sign-in** or **ANTHROPIC_API_KEY** (for migration and triage — scanning is free)

### Installation

```bash
git clone https://github.com/ankitjha67/evergreen.git
cd evergreen
npm install
```

### CLI Usage

Evergreen provides four commands:

#### `scan` — Find affected code (read-only, no AI)

```bash
npx tsx src/cli.ts scan --spec specs/stripe-2025-03-31-basil.json --repo /path/to/your/repo
```

Options:
| Flag | Description |
|---|---|
| `--spec <file>` | Path to a `BreakingChangeSpec` JSON file (required) |
| `--repo <path>` | Target repository (default: current directory) |
| `--triage` | Run Haiku triage to classify findings |
| `--json` | Machine-readable JSON output |

#### `migrate` — Scan + AI migration + branch delivery

```bash
npx tsx src/cli.ts migrate --spec specs/stripe-2025-03-31-basil.json --repo /path/to/your/repo
```

Options:
| Flag | Description |
|---|---|
| `--spec <file>` | Path to a `BreakingChangeSpec` JSON file (required) |
| `--repo <path>` | Target repository (default: current directory) |
| `--triage` | Run Haiku triage before migrating |
| `--dry-run` | Show the migration plan without making edits |
| `--verify` | Run the repo's verify command after migration |
| `--allow-dirty` | Proceed despite uncommitted changes |
| `--no-git` | Edit files in place (no branch, no commit) |
| `--model <id>` | Override the migration model (default: `claude-opus-5-5`) |
| `--threshold <n>` | Confidence gate 0..1 (default: 0.80) |
| `--json` | Machine-readable JSON output |

#### `report` — View the last migration report

```bash
npx tsx src/cli.ts report --repo /path/to/your/repo
```

#### `serve` — Start the GitHub App webhook server

```bash
npx tsx src/cli.ts serve --port 3000 --specs-dir specs
```

### Running Demos

Built-in demos run against fixture repos with real breaking change specs:

```bash
# Demo 1: Stripe basil — scan only (no AI, instant)
npm run demo:scan

# Demo 1: Stripe basil — full migration (needs Claude credentials)
npm run demo

# Demo 2: OpenAI v3→v4 — full migration with triage + verify
npm run demo2
```

**Demo 1** migrates `fixtures/demo-repo` for the Stripe 2025-03-31 "basil" breaking changes (invoice endpoint rename + subscription period field moves). Expect 7 findings across 2 files, confidences ~0.85.

**Demo 2** migrates `fixtures/demo-repo-2` for the openai-node v3→v4 rewrite (method renames, response shape changes, import rewrites, dependency floor). Includes triage (Haiku classifies 10 findings, discards 1 decoy) and verify (`node --check`). Cost: ~$0.26 migration + $0.20 triage.

---

## GitHub App Setup

Evergreen can run as a GitHub App that automatically scans repositories on every push and PR, posting findings as Check Run annotations directly in the GitHub UI.

### Register the App

1. Go to **GitHub Settings > Developer settings > GitHub Apps > New GitHub App**
2. Fill in:
   - **Name:** Your app name (e.g., "Evergreen API Scanner")
   - **Homepage URL:** `https://github.com/ankitjha67/evergreen`
   - **Webhook URL:** Your server URL + `/api/github/webhooks` (use [smee.io](https://smee.io) for local dev)
   - **Webhook secret:** Generate a strong random string
3. **Permissions:**
   - **Checks:** Read & write (to create Check Run annotations)
   - **Contents:** Read-only (to clone and scan repos)
   - **Metadata:** Read-only (required)
4. **Subscribe to events:** `push`, `pull_request`
5. After creating, **generate a private key** (downloads a `.pem` file)
6. Note your **App ID** from the app settings page

Alternatively, use the provided [`app-manifest.json`](app-manifest.json) for [GitHub App Manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest).

### Configure Environment

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
GITHUB_APP_ID=your_app_id
GITHUB_PRIVATE_KEY_PATH=./your-private-key.pem
GITHUB_WEBHOOK_SECRET=your_webhook_secret

# Optional
PORT=3000
LOG_LEVEL=info
SPECS_DIR=specs
```

You can also set `GITHUB_PRIVATE_KEY` directly (paste the PEM contents with `\n` for newlines) instead of using `GITHUB_PRIVATE_KEY_PATH`.

### Start the Server

```bash
npm run serve
```

The server starts on `http://localhost:3000` with:
- `GET /healthz` — Health check endpoint
- `POST /api/github/webhooks` — Webhook receiver (HMAC-SHA256 verified)

### Local Development with smee.io

For local development, use [smee.io](https://smee.io) to proxy GitHub webhooks to your machine:

```bash
# 1. Create a channel at https://smee.io (click "Start a new channel")
# 2. Use that URL as your GitHub App's webhook URL
# 3. Run the proxy:
npx smee --url https://smee.io/YOUR_CHANNEL_ID --target http://localhost:3000/api/github/webhooks

# 4. In another terminal, start the server:
npm run serve
```

When you push to any repo where the app is installed, you'll see:
1. Webhook received and signature verified in server logs
2. Repository shallow-cloned via installation token
3. All bundled specs scanned against the codebase
4. Check Run created with inline annotations on affected lines

---

## Changefeed Specs

A changefeed spec is a JSON file describing breaking changes in a vendor's API. Evergreen uses these to scan and migrate codebases.

### Bundled Specs

| Spec | Vendor | Breaking Changes | File |
|---|---|---|---|
| **Stripe basil** | Stripe API 2025-03-31 | `invoices.retrieveUpcoming` → `createPreview`, `current_period_start/end` moved to subscription items | [`stripe-2025-03-31-basil.json`](specs/stripe-2025-03-31-basil.json) |
| **OpenAI v4** | openai-node v3 → v4 | Method renames, response shape changes, import rewrites, async API changes | [`openai-node-v4.json`](specs/openai-node-v4.json) |

### Writing Your Own Spec

A `BreakingChangeSpec` follows this structure:

```jsonc
{
  "id": "vendor-version-codename",
  "vendor": "Vendor Name",
  "apiVersion": "2025-03-31",
  "codename": "codename",         // optional
  "title": "Human-readable title",
  "description": "What changed and why",
  "publishedAt": "2025-01-15",
  "deadline": "2026-12-31",        // migration deadline
  "docsUrl": "https://...",
  "languages": ["javascript", "typescript"],  // affected languages
  "rules": [
    {
      "id": "rule-id",
      "title": "Short rule title",
      "description": "What broke and how to fix it",
      "migrationGuide": "Step-by-step migration instructions",
      "docsUrl": "https://...",
      "patterns": [
        "\\.oldMethod\\(",
        "old_field_name"
      ],
      "filePatterns": ["**/*.js", "**/*.ts"],  // which files to scan
      "severity": "breaking"       // "breaking" | "deprecation" | "behavioral"
    }
  ]
}
```

Place your spec in `specs/` and the GitHub App server will automatically pick it up on next restart.

---

## Project Structure

```
evergreen/
├── src/
│   ├── cli.ts                  # CLI entry point (scan/migrate/report/serve)
│   ├── orchestrator.ts         # Wires the full pipeline
│   ├── types.ts                # Shared TypeScript types
│   ├── config.ts               # Configuration constants
│   ├── changefeed/
│   │   └── loader.ts           # BreakingChangeSpec validator + loader
│   ├── scanner/
│   │   └── scan.ts             # Deterministic regex scanner
│   ├── triage/
│   │   └── triage.ts           # Haiku 5.5 finding classifier
│   ├── migrator/
│   │   ├── agent.ts            # Opus 5.5 migration agent (Claude Agent SDK)
│   │   └── prompt.ts           # Migration prompt builder
│   ├── repo/
│   │   └── git.ts              # Git operations, safety checks, branch mgmt
│   ├── report/
│   │   └── report.ts           # MIGRATION_REPORT.md generator
│   ├── registry/
│   │   └── specs.ts            # Multi-spec loader for GitHub App
│   ├── github/
│   │   ├── client.ts           # GitHub App auth (JWT → installation token)
│   │   ├── clone.ts            # Shallow clone with token auth
│   │   └── checks.ts           # Check Run creation + annotations
│   └── server/
│       ├── app.ts              # Express server + webhook signature verification
│       └── webhooks.ts         # Push/PR/installation event handlers
├── specs/                      # Bundled changefeed specs
│   ├── stripe-2025-03-31-basil.json
│   └── openai-node-v4.json
├── tests/                      # Vitest test suite (25 tests)
│   ├── loader.test.ts
│   ├── scanner.test.ts
│   ├── git.test.ts
│   ├── prompt.test.ts
│   ├── checks.test.ts
│   ├── registry.test.ts
│   └── server.test.ts
├── fixtures/                   # Demo repositories for testing
│   ├── demo-repo/              # Stripe basil fixture
│   └── demo-repo-2/            # OpenAI v4 fixture
├── docs/                       # Living documentation suite
│   ├── CONTEXT.md              # Current state — read this first
│   ├── BRD.md                  # Business Requirements
│   ├── PRD.md                  # Product Requirements
│   ├── FSD.md                  # Functional Specification (FR-IDs)
│   ├── ARCHITECTURE.md         # Architecture + ADRs
│   └── SYSTEM_DESIGN.md        # System Design (stack, sequences, security)
├── scripts/
│   └── local-webhook-test.ts   # Local webhook testing helper
├── app-manifest.json           # GitHub App Manifest for registration
├── .env.example                # Environment variable template
├── CLAUDE.md                   # Working agreement for AI contributors
├── tsconfig.json               # TypeScript strict config
└── package.json                # Dependencies and scripts
```

---

## Testing

```bash
# Run all tests
npm test

# Run with verbose output
npx vitest run --reporter=verbose
```

**25 tests** covering:
- **Loader** — spec validation, schema enforcement, edge cases
- **Scanner** — pattern matching, multi-rule dedup, file filtering
- **Git** — porcelain parsing, branch operations, safety checks
- **Prompt** — migration prompt construction from findings
- **Checks** — annotation mapping, 50-annotation batching, conclusion logic
- **Registry** — spec loading, language filtering, lookup
- **Server** — health endpoint, webhook signature verification

---

## Safety & Trust Model

Evergreen is designed for zero-trust operation on production codebases:

| Principle | Implementation |
|---|---|
| **Read-only by default** | `scan` makes zero changes. Migration requires explicit `migrate` command. |
| **Branch isolation** | All edits go to `evergreen/*` branches. Never touches `main`. |
| **Dirty-tree refusal** | Refuses to run on repos with uncommitted changes (override: `--allow-dirty`). |
| **Confidence gating** | Files below the threshold (default 0.80) are reverted automatically. |
| **Restricted agent tools** | Migration agent has Read/Edit/Write/Grep/Glob only. No shell, no network. |
| **Out-of-scope detection** | Any edit outside the declared work list is reverted with a violation logged. |
| **Restore on failure** | If the agent fails mid-run, all changes are rolled back to the pre-run state. |
| **PRs, never pushes** | Evergreen never pushes to user branches, never merges, never auto-merges. |
| **Webhook verification** | GitHub App uses HMAC-SHA256 signature verification on every webhook. |
| **Scoped tokens** | Installation tokens are scoped per-installation with minimal permissions. |
| **Evidence trail** | Every migration produces a `MIGRATION_REPORT.md` with per-file confidence, cost, and manifest. |

---

## Roadmap

| Release | Status | Highlights |
|---|---|---|
| **0.1** — MVP | ✅ Done | CLI scan + migrate, Opus 5.5 agent, branch delivery, evidence report |
| **0.2** — Triage + Verify | ✅ Done | Haiku triage, verify-command gating, 2nd changefeed (OpenAI v4), 16 tests |
| **0.3** — GitHub App | ✅ Done | Webhook server, Check Run annotations, multi-spec registry, 25 tests, real app verified |
| **0.4** — Hosted + Auto-PR | Planned | Deploy to cloud, auto-trigger `migrate` and open PRs, billing integration |
| **0.5** — Multi-language | Planned | Python, Go support; community spec contributions |
| **1.0** — GA | Planned | Vendor portal, marketplace listing, SLA-backed scanning |

---

## Documentation

The docs suite is the source of truth. Read [`docs/CONTEXT.md`](docs/CONTEXT.md) first — it maps the full suite:

| Document | Purpose |
|---|---|
| [`CONTEXT.md`](docs/CONTEXT.md) | Current state, decision log, progress — **read this first** |
| [`BRD.md`](docs/BRD.md) | Business requirements: market, model, GTM, risks |
| [`PRD.md`](docs/PRD.md) | Product requirements: epics, stories, MVP cut, metrics |
| [`FSD.md`](docs/FSD.md) | Functional specification with FR-IDs — **code must match this** |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Components, boundaries, ADRs |
| [`SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) | Stack, data models, sequences, security design |
| [`CLAUDE.md`](CLAUDE.md) | Working agreement for AI-assisted development |

---

## Contributing

Evergreen uses a docs-first development model:

1. **Read [`docs/CONTEXT.md`](docs/CONTEXT.md)** before any work
2. **Behavior changes** → update [`FSD.md`](docs/FSD.md) first, then code
3. **Structural changes** → update [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) / [`SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) first
4. **New decisions** → log in `CONTEXT.md` §4 Decision Log
5. **After every session** → append to `CONTEXT.md` §6 Progress Log

Every source module's header comment names the FR-IDs it implements (e.g., `// FR-03.1 — Impact Scanner`). Keep these accurate.

### Tech Stack

- **Runtime:** Node.js >= 20, TypeScript strict, ESM
- **AI:** Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Opus 5.5 (migration), Haiku 5.5 (triage)
- **Server:** Express 5, `@octokit/webhooks`, `@octokit/rest`, `@octokit/auth-app`
- **CLI:** Commander
- **Tests:** Vitest
- **Scanner:** fast-glob + native regex (no AI)

---

*Built by [@ankitjha67](https://github.com/ankitjha67) with Claude.*
