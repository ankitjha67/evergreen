# Evergreen — Working Agreement for AI-Assisted Development

## Docs are the source of truth
1. **Before any implementation work in this repo, read `docs/CONTEXT.md`** — it holds current state, the decision log, and the doc map. Then read the specific doc governing what you're touching (FSD for behavior, SYSTEM_DESIGN for structure).
2. Code must match `docs/FSD.md`. To change behavior: update FSD **first**, then code.
3. Structural changes: update `docs/ARCHITECTURE.md` / `docs/SYSTEM_DESIGN.md` first.
4. Every source module's header comment names the FR-IDs it implements (e.g. `// FR-03.1 — Impact Scanner`). Keep these accurate.

## After every working session
- Append to `docs/CONTEXT.md` §6 Progress Log (date, what changed, what's next).
- Record new decisions in §4 Decision Log; update §3 status table.

## Hard rules (from FSD)
- Git safety protocol FR-02.2: refuse dirty trees for migrate; all edits on `evergreen/*` branches; never force-push/merge/auto-merge/amend.
- Migration agent tool surface: Read/Edit/Write/Grep/Glob only — no Bash, no network (FR-04.1).
- PRs, never pushes to user branches. No auto-merge, ever (PRD §4.1).
- Models: `claude-opus-5-5` (migration), `claude-haiku-5-5` (triage) — changes go through ADR process.

## Build/test
- Node ≥ 20, TypeScript strict, ESM. `npm run build` (tsc), `npm test` (vitest), demos: `npm run demo:scan` / `npm run demo` / `npm run demo2`. Server: `npm run serve` (requires GITHUB_APP_ID, GITHUB_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET env vars).
