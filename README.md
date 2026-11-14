# Evergreen

**Self-maintaining APIs.** When an API vendor ships a breaking change, Evergreen scans every connected codebase, rewrites only the affected code, and delivers it as a reviewable branch with an evidence report -- before anything breaks in production.

> Dependabot bumps your dependency version. **Evergreen rewrites your code to actually work with it.**

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-118%20passing-brightgreen)](tests/)
[![Providers](https://img.shields.io/badge/LLM%20providers-15-purple)]()
[![License](https://img.shields.io/badge/license-UNLICENSED-lightgrey)]()

Origin: YC Fall 2026 RFS "Self-Maintaining APIs" -- ranked #1 of 107 RFS ideas in our competitive study (zero funded competition, Nov 2026).

---

## Table of Contents

- [How It Works](#how-it-works)
- [LLM Providers](#llm-providers)
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
- [Auto-PR on Webhook](#auto-pr-on-webhook)
- [Docker Deployment](#docker-deployment)
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
Vendor publishes spec --> Evergreen scans repos --> Agent migrates code --> PR delivered for review
```

1. **Changefeed** - A vendor publishes a `BreakingChangeSpec` (open JSON format). Each spec declares rules with regex patterns, affected API versions, migration guidance, and deadlines. See [`specs/`](specs/) for examples.

2. **Scan** - A deterministic regex-based scanner finds every affected `file:line` across the codebase. No AI involved -- cheap, fast (~17ms for a typical repo), and fully auditable.

3. **Triage** *(optional)* - Claude Haiku 5.5 classifies each finding as `affected`, `not_affected`, or `needs_review`, filtering out false positives before the expensive migration step (~$0.20/run).

4. **Migrate** - An LLM agent (default: Claude Opus 5.5, or [any of 15 supported providers](#llm-providers)) edits *only* the affected files under a strict **minimal-diff contract**: no reformatting, no unrelated changes, no new dependencies unless justified. Every edited file gets a per-file confidence score.

5. **Enforce** - The orchestrator reverts any out-of-scope edits and files below the confidence threshold (default: 0.80). Optional verify command (e.g., `node --check`) gates delivery.

6. **Deliver** - One atomic commit on an isolated `evergreen/<vendor>-<version>` branch, plus a `MIGRATION_REPORT.md` with full evidence. PRs only, never pushes. A human reviews and merges.

### GitHub App Mode

When installed as a GitHub App, Evergreen runs automatically:

```
Push/PR on GitHub --> Webhook --> Shallow clone --> Scan all specs --> Check Run with annotations
```

- Receives push and pull request webhooks
- Shallow-clones the repo using installation tokens
- Scans against all bundled changefeed specs
- Posts findings as **GitHub Check Run annotations** on the exact affected lines
- Shows a summary table with rules, file counts, migration deadline, and a CTA to run the migration CLI

### Auto-Migrate Mode

With `AUTO_MIGRATE=true`, Evergreen goes beyond alerting -- it fixes the code too:

```
Findings detected --> Migration agent runs --> Push evergreen/* branch --> Open PR --> Update Check Run
```

- Runs the full migration pipeline using your configured [LLM provider](#llm-providers)
- Pushes an `evergreen/<vendor>-<api>-<version>` branch with the migration commit
- Opens a PR with a detailed evidence report (file-by-file status, confidence scores, review checklist)
- Updates the Check Run with a link to the PR
- All usage is logged to `data/usage.jsonl` for cost tracking

---

## LLM Providers

Evergreen supports **15 LLM providers** out of the box. Use any model that fits your budget, latency, or data-residency requirements.

```bash
# List all providers and their configuration status
npx tsx src/cli.ts providers

# Migrate with a specific provider
npx tsx src/cli.ts migrate --spec specs/stripe-2025-03-31-basil.json --provider groq

# Or set a default via environment variable
export MIGRATION_PROVIDER=deepseek
```

### Supported Providers

| Provider | ID | Default Model | Auth | Type |
|---|---|---|---|---|
| **Anthropic Claude** | `anthropic` | `claude-opus-5-5` | `ANTHROPIC_API_KEY` | Cloud |
| **OpenAI** | `openai` | `gpt-4o` | `OPENAI_API_KEY` | Cloud |
| **Google Gemini** | `gemini` | `gemini-2.5-pro` | `GOOGLE_API_KEY` | Cloud |
| **Groq** | `groq` | `llama-3.3-70b-versatile` | `GROQ_API_KEY` | Cloud |
| **Together AI** | `together` | `Meta-Llama-3.1-70B-Instruct-Turbo` | `TOGETHER_API_KEY` | Cloud |
| **Fireworks AI** | `fireworks` | `llama-v3p3-70b-instruct` | `FIREWORKS_API_KEY` | Cloud |
| **DeepSeek** | `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` | Cloud |
| **NVIDIA NIM** | `nvidia-nim` | `meta/llama-3.3-70b-instruct` | `NVIDIA_API_KEY` | Cloud |
| **Mistral AI** | `mistral` | `mistral-large-latest` | `MISTRAL_API_KEY` | Cloud |
| **OpenRouter** | `openrouter` | `anthropic/claude-opus-5-5` | `OPENROUTER_API_KEY` | Cloud |
| **Perplexity** | `perplexity` | `llama-3.1-sonar-large-128k-online` | `PERPLEXITY_API_KEY` | Cloud |
| **Anyscale** | `anyscale` | `Meta-Llama-3.1-70B-Instruct` | `ANYSCALE_API_KEY` | Cloud |
| **Azure OpenAI** | `azure-openai` | `gpt-4o` | `AZURE_OPENAI_API_KEY` | Cloud |
| **Ollama** | `ollama` | `llama3.3:70b` | None (local) | Local |
| **LM Studio** | `lmstudio` | `local-model` | None (local) | Local |
| **vLLM** | `vllm` | `default` | None (local) | Local |

### Provider Architecture

All providers implement a unified `LLMProvider` interface with a single `chat()` method. A provider-agnostic agent loop drives any LLM through the migration using the same shared tool implementations (Read, Edit, Write, Grep, Glob). This means:

- **Same migration quality** - the prompt, tools, and enforcement are identical regardless of provider
- **Same safety guarantees** - path-traversal protection, confidence gating, and restore-on-failure work with every provider
- **Zero code changes** - switch providers with a flag or env var, nothing else

The 12 OpenAI-compatible providers (Ollama through Azure) use the OpenAI SDK with a configurable `baseURL`, so they need zero additional dependencies.

### Dynamic Model Discovery

Providers with an API key can query their endpoint for available models at runtime:

```bash
# Discover models from all configured providers
npx tsx src/cli.ts providers --discover
```

The core providers (Anthropic, OpenAI, Gemini) implement `listModels()` to fetch available models from their API. Results are cached for 5 minutes. When no explicit model is set, `selectBestModel()` picks the model with the largest context window.

### Cross-Provider Fallback

Configure multiple providers as fallbacks -- if one fails (deprecated model, API down, rate limit), the next takes over automatically:

```bash
# CLI flag
npx tsx src/cli.ts migrate --spec specs/stripe-2025-03-31-basil.json --fallback openai,gemini

# Environment variable
export MIGRATION_FALLBACK_PROVIDERS=openai,gemini

# Or in .evergreen.yaml
# fallback:
#   - openai
#   - gemini
```

### Configurable Token Limits

Set max input and output tokens per migration to match your model's capabilities or budget:

```bash
npx tsx src/cli.ts migrate --spec specs/stripe-2025-03-31-basil.json \
  --max-input-tokens 200000 --max-output-tokens 16384
```

Token limits can also be set in `.evergreen.yaml` (`maxInputTokens`, `maxOutputTokens`).

---

## Architecture

```
+------------------------------------------------------------------+
|                        CLI (commander)                            |
|  scan . migrate . report . diff . validate . init . fetch-spec   |
|  specs . scan-all . serve . usage . providers                    |
+--------+----------+----------+----------+------------------------+
         |          |          |          |
    +----v---+ +----v---+ +---v----+ +---v----------------+
    | Loader | |Scanner | |Migrate | |  GitHub App        |
    | FR-01  | |FR-03.1 | | FR-04  | |  Server (FR-08)    |
    +----+---+ +----+---+ +---+----+ +---+----------------+
         |          |         |           |
    specs/*.json    |    +----v-----+     |
                    |    | Provider |     |
              +-----v--+| Registry | +---v--------------+
              | Triage  || FR-09    | | Auto-PR          |
              | FR-03.2 || 15 LLMs  | | FR-10            |
              |Haiku5.5 |+----------+ | Webhooks         |
              +--------+             | Check Runs       |
                                     | Shallow Clone    |
                                     | Retry Queue      |
                                     +------------------+
```

| Component | Module | Purpose |
|---|---|---|
| Changefeed Loader | `src/changefeed/loader.ts` | Validates and loads `BreakingChangeSpec` JSON |
| Spec Fetcher | `src/changefeed/fetch.ts` | Downloads specs from HTTP(S) URLs |
| Scanner | `src/scanner/scan.ts` | Deterministic regex scan, produces `{file, line, rule}` findings |
| Triage | `src/triage/triage.ts` | Haiku 5.5 classifies findings (affected / not_affected / needs_review) |
| Migration Agent | `src/migrator/agent.ts` | Opus 5.5 via Claude Agent SDK, minimal-diff contract |
| Prompt Builder | `src/migrator/prompt.ts` | Constructs the migration prompt from spec + findings |
| Git Safety | `src/repo/git.ts` | Branch isolation, dirty-tree checks, restore-on-failure |
| Report Generator | `src/report/report.ts` | Generates `MIGRATION_REPORT.md` with evidence |
| Orchestrator | `src/orchestrator.ts` | Wires scan, triage, migrate, enforce, and deliver |
| Config Loader | `src/config.ts` | `.evergreen.json` / `.evergreen.yaml` repo config |
| Structured Logger | `src/logger.ts` | Leveled logging (debug/info/warn/error), JSON mode |
| Spec Registry | `src/registry/specs.ts` | Loads all bundled specs, filters by language |
| GitHub Client | `src/github/client.ts` | App JWT to installation token auth chain |
| Shallow Clone | `src/github/clone.ts` | `git clone --depth 1` with installation token |
| Check Runs | `src/github/checks.ts` | Creates Check Runs with per-line annotations |
| Webhook Server | `src/server/app.ts` | Express + HMAC-SHA256 webhook signature verification |
| Webhook Handlers | `src/server/webhooks.ts` | push/PR/installation event processing + auto-migrate |
| Admin Dashboard | `src/server/dashboard.ts` | HTML dashboard with spec status, events, and usage |
| Event Log | `src/server/event-log.ts` | In-memory ring buffer for webhook event history |
| Retry Queue | `src/server/retry-queue.ts` | Exponential backoff retry for failed webhook handlers |
| Provider Types | `src/providers/types.ts` | `LLMProvider` interface, pricing map, provider config |
| Agent Loop | `src/providers/agent-loop.ts` | Provider-agnostic agentic migration loop |
| Shared Tools | `src/providers/tools.ts` | Read/Edit/Write/Grep/Glob with path-traversal jail |
| Anthropic Provider | `src/providers/anthropic.ts` | Claude via `@anthropic-ai/sdk` Messages API |
| OpenAI Provider | `src/providers/openai.ts` | GPT-4o/o3 via `openai` SDK (also base for compatible) |
| OpenAI-Compatible | `src/providers/openai-compat.ts` | 12 provider presets via configurable baseURL |
| Gemini Provider | `src/providers/gemini.ts` | Gemini via `@google/generative-ai` |
| Provider Registry | `src/providers/registry.ts` | Factory, preset resolution, env discovery |
| Auto-PR | `src/github/pr.ts` | Branch push + PR creation with evidence report |
| Usage Tracking | `src/usage.ts` | JSONL logging for cost/token tracking |
| CLI | `src/cli.ts` | Commander-based CLI with 12 commands |

---

## Getting Started

### Prerequisites

- **Node.js** >= 20
- **npm** (comes with Node.js)
- **Git** (for migration branch delivery)
- **LLM API key** for migration: `ANTHROPIC_API_KEY` (default), `OPENAI_API_KEY`, `GOOGLE_API_KEY`, or any of [15 supported providers](#llm-providers). Local providers like Ollama need no key. Scanning is free -- no AI needed.

### Installation

```bash
git clone https://github.com/ankitjha67/evergreen.git
cd evergreen
npm install
```

### CLI Usage

Evergreen provides 12 commands:

#### `scan` - Find affected code (read-only, no AI)

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

#### `migrate` - Scan + AI migration + branch delivery

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
| `--provider <id>` | LLM provider: `anthropic`, `openai`, `gemini`, `ollama`, `groq`, etc. ([full list](#llm-providers)) |
| `--fallback <ids>` | Comma-separated fallback provider IDs (e.g., `openai,gemini`) |
| `--max-input-tokens <n>` | Max input tokens for the LLM |
| `--max-output-tokens <n>` | Max output tokens for the LLM |
| `--threshold <n>` | Confidence gate 0..1 (default: 0.80) |
| `--json` | Machine-readable JSON output |

#### `diff` - Preview migration changes without running the agent

```bash
npx tsx src/cli.ts diff --spec specs/stripe-2025-03-31-basil.json --repo /path/to/your/repo
```

Shows findings grouped by file with before/after snippets and migration guidance. Supports `--triage` and `--json`.

#### `scan-all` - Scan against all bundled specs

```bash
npx tsx src/cli.ts scan-all --repo /path/to/your/repo
```

Scans the repo against every bundled changefeed spec concurrently. Supports `--lang <language>` to filter specs and `--json` for machine-readable output.

#### `validate` - Validate a changefeed spec

```bash
npx tsx src/cli.ts validate specs/stripe-2025-03-31-basil.json
```

Validates the JSON structure, shows ref, title, languages, rules, and per-rule breakdown. Supports `--json`.

#### `fetch-spec` - Download a spec from a URL

```bash
npx tsx src/cli.ts fetch-spec https://example.com/spec.json --out specs
```

Downloads, validates, and saves a changefeed spec from an HTTP(S) URL.

#### `specs` - List bundled changefeed specs

```bash
npx tsx src/cli.ts specs --lang javascript
```

Lists all bundled specs with ref, title, languages, rule count, and deadline. Supports `--lang` filter and `--json`.

#### `init` - Create repo config

```bash
npx tsx src/cli.ts init --repo /path/to/your/repo
```

Creates a `.evergreen.yaml` config file with documented options (provider, threshold, verify command, triage toggle).

#### `report` - View the last migration report

```bash
npx tsx src/cli.ts report --repo /path/to/your/repo
```

#### `serve` - Start the GitHub App webhook server

```bash
npx tsx src/cli.ts serve --port 3000 --specs-dir specs
```

#### `usage` - Show usage statistics

```bash
npx tsx src/cli.ts usage --limit 20
```

Shows scan/migration event history, cost totals, token breakdowns, and per-provider/per-repo stats. Supports `--json`.

#### `providers` - List available LLM providers

```bash
# List all providers and configuration status
npx tsx src/cli.ts providers

# Discover available models from configured providers
npx tsx src/cli.ts providers --discover

# Machine-readable output
npx tsx src/cli.ts providers --json
```

Shows all 15 supported providers with their configuration status (ready vs. needs API key). With `--discover`, queries each configured provider's API for live model lists.

### Running Demos

Built-in demos run against fixture repos with real breaking change specs:

```bash
# Demo 1: Stripe basil - scan only (no AI, instant)
npm run demo:scan

# Demo 1: Stripe basil - full migration (needs Claude credentials)
npm run demo

# Demo 2: OpenAI v3 to v4 - full migration with triage + verify
npm run demo2
```

**Demo 1** migrates `fixtures/demo-repo` for the Stripe 2025-03-31 "basil" breaking changes (invoice endpoint rename + subscription period field moves). Expect 7 findings across 2 files, confidences ~0.85.

**Demo 2** migrates `fixtures/demo-repo-2` for the openai-node v3-to-v4 rewrite (method renames, response shape changes, import rewrites, dependency floor). Includes triage (Haiku classifies 10 findings, discards 1 decoy) and verify (`node --check`). Cost: ~$0.26 migration + $0.20 triage.

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
- `GET /healthz` - Health check endpoint
- `GET /admin` - Admin dashboard (spec status, events, usage)
- `POST /api/github/webhooks` - Webhook receiver (HMAC-SHA256 verified)

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

When you push to any repo where the app is installed, you will see:
1. Webhook received and signature verified in server logs
2. Repository shallow-cloned via installation token
3. All bundled specs scanned against the codebase
4. Check Run created with inline annotations on affected lines

---

## Auto-PR on Webhook

When `AUTO_MIGRATE=true` is set, Evergreen automatically creates migration PRs when breaking changes are detected:

1. Scanner detects findings, Check Run set to "in progress"
2. Migration agent runs using your configured LLM provider
3. Agent commits changes to an `evergreen/<vendor>-<api>-<version>` branch
4. PR is opened with a detailed evidence report including:
   - File-by-file migration status and confidence scores
   - Applied rules per file
   - Skipped files with reasons
   - Human review checklist
5. Check Run updated with link to the PR

```bash
# Enable auto-migration in your .env
AUTO_MIGRATE=true

# Optionally configure which provider to use
MIGRATION_PROVIDER=deepseek  # Default: anthropic
```

All migration usage (tokens, cost, provider, model, duration) is logged to `data/usage.jsonl` for cost tracking and auditing.

---

## Docker Deployment

Evergreen ships with a production-ready Dockerfile:

```bash
# Build
docker build -t evergreen .

# Run the webhook server
docker run -p 3000:3000 \
  -e GITHUB_APP_ID=your_app_id \
  -e GITHUB_PRIVATE_KEY="$(cat your-key.pem)" \
  -e GITHUB_WEBHOOK_SECRET=your_secret \
  -e ANTHROPIC_API_KEY=your_key \
  -e AUTO_MIGRATE=true \
  -v ./specs:/app/specs \
  -v ./data:/app/data \
  evergreen
```

The image uses a multi-stage build (builder + slim runtime), includes git for shallow cloning, and runs as `NODE_ENV=production`.

### Deploy to Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template)

1. Fork this repo and connect it to Railway
2. Set environment variables in Railway dashboard: `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and your LLM provider key (e.g. `ANTHROPIC_API_KEY`)
3. Railway auto-detects `railway.json` -- builds from the Dockerfile, uses `/healthz` healthcheck
4. Update your GitHub App's webhook URL to `https://your-app.up.railway.app/api/github/webhooks`

### Deploy to Render

1. Fork this repo and create a new Web Service on Render
2. Render auto-detects `render.yaml` -- set secret env vars (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`)
3. Update your GitHub App's webhook URL to `https://your-app.onrender.com/api/github/webhooks`

### Server Endpoints

| Endpoint | Purpose | Response |
|---|---|---|
| `GET /healthz` | Liveness - process is running | `200` with version, uptime, spec count |
| `GET /ready` | Readiness - specs loaded, ready to serve | `200` if specs > 0, `503` otherwise |
| `GET /admin` | Admin dashboard - visual overview | HTML page with specs, events, usage |
| `GET /api/specs` | List loaded changefeed specs | JSON with spec refs, rules, languages |
| `GET /api/events` | Recent webhook events + stats | JSON with event log and breakdown |
| `GET /api/usage` | Usage stats from `data/usage.jsonl` | `200` with by-event, by-provider, by-repo breakdowns, cost totals |
| `POST /api/github/webhooks` | Webhook receiver | HMAC-SHA256 verified, rate limited (60 req/min) |

---

## Changefeed Specs

A changefeed spec is a JSON file describing breaking changes in a vendor's API. Evergreen uses these to scan and migrate codebases.

### Bundled Specs

| Spec | Vendor | Languages | Breaking Changes | File |
|---|---|---|---|---|
| **Stripe basil (Node)** | Stripe API 2025-03-31 | JavaScript, TypeScript | `invoices.retrieveUpcoming` renamed to `createPreview`, `current_period_start/end` moved to subscription items | [`stripe-2025-03-31-basil.json`](specs/stripe-2025-03-31-basil.json) |
| **Stripe basil (Python)** | Stripe API 2025-03-31 | Python | `Invoice.upcoming` renamed to `Invoice.create_preview`, `current_period_start/end` moved, `stripe.api_key` to `StripeClient` | [`stripe-python-2025-03-31-basil.json`](specs/stripe-python-2025-03-31-basil.json) |
| **OpenAI v4** | openai-node v3 to v4 | JavaScript, TypeScript | Method renames, response shape changes, import rewrites, async API changes | [`openai-node-v4.json`](specs/openai-node-v4.json) |

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

Place your spec in `specs/` and the GitHub App server will automatically pick it up on next restart (or immediately with hot-reload).

---

## Project Structure

```
evergreen/
├── src/
│   ├── cli.ts                  # CLI entry point (12 commands)
│   ├── orchestrator.ts         # Wires the full pipeline
│   ├── types.ts                # Shared TypeScript types
│   ├── config.ts               # Repo config loader (.evergreen.json/.yaml)
│   ├── logger.ts               # Structured leveled logger
│   ├── changefeed/
│   │   ├── loader.ts           # BreakingChangeSpec validator + loader
│   │   └── fetch.ts            # Spec fetcher from HTTP(S) URLs
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
│   │   └── specs.ts            # Multi-spec loader with hot-reload
│   ├── providers/              # Multi-LLM provider abstraction (FR-09)
│   │   ├── types.ts            # LLMProvider interface, pricing, config
│   │   ├── agent-loop.ts       # Provider-agnostic migration loop
│   │   ├── tools.ts            # Shared tools (Read/Edit/Write/Grep/Glob)
│   │   ├── anthropic.ts        # Anthropic Claude provider
│   │   ├── openai.ts           # OpenAI provider
│   │   ├── openai-compat.ts    # 12 OpenAI-compatible presets
│   │   ├── gemini.ts           # Google Gemini provider
│   │   ├── discovery.ts        # Model discovery cache, FallbackProvider, selectBestModel
│   │   └── registry.ts         # Provider factory + fallback chain builder
│   ├── github/
│   │   ├── client.ts           # GitHub App auth (JWT to installation token)
│   │   ├── clone.ts            # Shallow clone with token auth
│   │   ├── checks.ts           # Check Run creation + annotations
│   │   └── pr.ts               # Auto-PR creation with evidence report
│   ├── usage.ts                # Usage tracking (JSONL logger)
│   └── server/
│       ├── app.ts              # Express server + webhook sig verification
│       ├── webhooks.ts         # Event handlers + auto-migrate (FR-10)
│       ├── dashboard.ts        # Admin dashboard HTML renderer
│       ├── event-log.ts        # Webhook event ring buffer
│       └── retry-queue.ts      # Exponential backoff retry queue
├── specs/                      # Bundled changefeed specs
│   ├── stripe-2025-03-31-basil.json
│   ├── stripe-python-2025-03-31-basil.json
│   └── openai-node-v4.json
├── tests/                      # Vitest test suite (118 tests, 20 suites)
│   ├── loader.test.ts          # Spec validation, schema enforcement
│   ├── scanner.test.ts         # Pattern matching, dedup, file filtering
│   ├── git.test.ts             # Porcelain parsing, branch ops, safety
│   ├── prompt.test.ts          # Migration prompt construction
│   ├── checks.test.ts          # Annotation mapping, batching, conclusion
│   ├── registry.test.ts        # Spec loading, language filtering
│   ├── server.test.ts          # Health endpoint, webhook signature
│   ├── providers.test.ts       # Registry, tools, pricing, path-traversal
│   ├── mock-provider.ts        # Scriptable mock LLM for tests
│   ├── agent-loop.test.ts      # Full agent pipeline integration
│   ├── usage.test.ts           # JSONL logging, aggregation
│   ├── auto-pr.test.ts         # Branch naming, manifest validation
│   ├── event-log.test.ts       # Event ring buffer
│   ├── dashboard.test.ts       # Dashboard HTML, specs API
│   ├── config.test.ts          # YAML/JSON config loading
│   ├── python-spec.test.ts     # Python spec + fixture scanning
│   ├── logger.test.ts          # Structured logger
│   ├── fetch-spec.test.ts      # Spec URL fetching
│   ├── diff.test.ts            # Diff preview logic
│   ├── retry-queue.test.ts     # Retry queue + dead-letter
│   └── scan-all.test.ts        # Concurrent multi-spec scan
├── fixtures/                   # Demo repositories for testing
│   ├── demo-repo/              # Stripe basil JS fixture
│   ├── demo-repo-2/            # OpenAI v4 JS fixture
│   └── demo-repo-python/       # Stripe basil Python fixture
├── docs/                       # Living documentation suite
│   ├── CONTEXT.md              # Current state - read this first
│   ├── BRD.md                  # Business Requirements
│   ├── PRD.md                  # Product Requirements
│   ├── FSD.md                  # Functional Specification (FR-IDs)
│   ├── ARCHITECTURE.md         # Architecture + ADRs
│   └── SYSTEM_DESIGN.md        # System Design (stack, sequences, security)
├── .github/
│   └── workflows/
│       └── ci.yml              # GitHub Actions CI (Node 20+22 matrix)
├── scripts/
│   └── local-webhook-test.ts   # Local webhook testing helper
├── Dockerfile                  # Multi-stage production Docker image
├── .dockerignore               # Docker build exclusions
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

**118 tests** across **20 suites**:
- **Loader** - spec validation, schema enforcement, edge cases
- **Scanner** - pattern matching, multi-rule dedup, file filtering
- **Git** - porcelain parsing, branch operations, safety checks
- **Prompt** - migration prompt construction from findings
- **Checks** - annotation mapping, 50-annotation batching, conclusion logic
- **Registry** - spec loading, language filtering, lookup
- **Server** - health endpoint, webhook signature verification
- **Providers** - registry discovery, tool definitions, pricing map, path-traversal prevention, preset validation, model discovery cache, FallbackProvider, fallback chain construction
- **Mock Provider** - scriptable LLM for deterministic agent testing
- **Agent Loop** - full provider-agnostic pipeline integration
- **Usage** - JSONL logging, multi-record append, directory creation
- **Auto-PR** - branch naming, specRef formatting, manifest shape validation
- **Event Log** - ring buffer, stats, capacity limits
- **Dashboard** - HTML rendering, XSS safety, specs API
- **Config** - YAML/JSON config loading, precedence, defaults, token limits, fallback provider list
- **Python Spec** - Python language support, fixture scanning
- **Logger** - structured logging, levels, JSON mode
- **Fetch Spec** - HTTP(S) download, validation, save
- **Diff** - migration preview, grouping, rule mapping
- **Retry Queue** - exponential backoff, dead-letter queue
- **Scan-All** - concurrent multi-spec scanning, result parity

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
| **Rate limiting** | Webhook endpoint is rate-limited (60 req/min per IP). |
| **Scoped tokens** | Installation tokens are scoped per-installation with minimal permissions. |
| **Retry with backoff** | Failed webhook handlers retry with exponential backoff, dead-letter after 3 attempts. |
| **Evidence trail** | Every migration produces a `MIGRATION_REPORT.md` with per-file confidence, cost, and manifest. |

---

## Roadmap

| Release | Status | Highlights |
|---|---|---|
| **0.1** - MVP | Done | CLI scan + migrate, Opus 5.5 agent, branch delivery, evidence report |
| **0.2** - Triage + Verify | Done | Haiku triage, verify-command gating, 2nd changefeed (OpenAI v4), 16 tests |
| **0.3** - GitHub App | Done | Webhook server, Check Run annotations, multi-spec registry, 25 tests |
| **0.4** - Multi-LLM + Auto-PR | Done | 15 LLM providers, auto-migrate on webhook, Dockerfile, usage tracking, 46 tests |
| **0.5** - Production Readiness | Done | CLI usage command, graceful shutdown, request logging, rate limiting, 61 tests |
| **0.6** - Observability | Done | Admin dashboard, specs/events API, event log, spec hot-reload, 70 tests |
| **0.7** - Python + Config | Done | Python language support, validate/init CLI, YAML config, specRef fix, 85 tests |
| **0.8** - CI/CD + Tooling | Done | GitHub Actions CI, diff preview, spec fetch, structured logger, 94 tests |
| **0.9** - Multi-Spec Scan | Done | Concurrent scan-all, retry queue, specs CLI, 103 tests |
| **0.9.1** - Model Resilience | Done | Dynamic model discovery, cross-provider fallback, configurable token limits, 118 tests |
| **1.0** - GA | Planned | Vendor portal, marketplace listing, SLA-backed scanning |

---

## Documentation

The docs suite is the source of truth. Read [`docs/CONTEXT.md`](docs/CONTEXT.md) first -- it maps the full suite:

| Document | Purpose |
|---|---|
| [`CONTEXT.md`](docs/CONTEXT.md) | Current state, decision log, progress -- **read this first** |
| [`BRD.md`](docs/BRD.md) | Business requirements: market, model, GTM, risks |
| [`PRD.md`](docs/PRD.md) | Product requirements: epics, stories, MVP cut, metrics |
| [`FSD.md`](docs/FSD.md) | Functional specification with FR-IDs -- **code must match this** |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Components, boundaries, ADRs |
| [`SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) | Stack, data models, sequences, security design |
| [`CLAUDE.md`](CLAUDE.md) | Working agreement for AI-assisted development |

---

## Contributing

Evergreen uses a docs-first development model:

1. **Read [`docs/CONTEXT.md`](docs/CONTEXT.md)** before any work
2. **Behavior changes** - update [`FSD.md`](docs/FSD.md) first, then code
3. **Structural changes** - update [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) / [`SYSTEM_DESIGN.md`](docs/SYSTEM_DESIGN.md) first
4. **New decisions** - log in `CONTEXT.md` Decision Log
5. **After every session** - append to `CONTEXT.md` Progress Log

Every source module's header comment names the FR-IDs it implements (e.g., `// FR-03.1 - Impact Scanner`). Keep these accurate.

### Tech Stack

- **Runtime:** Node.js >= 20, TypeScript strict, ESM
- **AI:** 15 LLM providers via `LLMProvider` abstraction -- Anthropic (`@anthropic-ai/sdk`), OpenAI (`openai` v7), Google Gemini (`@google/generative-ai`), plus 12 OpenAI-compatible providers. Dynamic model discovery, cross-provider fallback chain, configurable token limits. Claude Agent SDK for triage.
- **Server:** Express 5, `@octokit/webhooks`, `@octokit/rest`, `@octokit/auth-app`
- **CLI:** Commander (12 commands)
- **Tests:** Vitest (118 tests, 20 suites)
- **Scanner:** fast-glob + native regex (no AI)
- **CI:** GitHub Actions (Node 20+22 matrix, typecheck)
- **Deploy:** Docker (multi-stage build), Railway, Render

---

*Built by [@ankitjha67](https://github.com/ankitjha67).*
