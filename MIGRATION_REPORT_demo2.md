# Evergreen Migration Report
**Spec:** openai@v4 — openai-node v3 → v4 SDK migration
**Upgrade guide:** https://github.com/openai/openai-node/discussions/217
**Status:** migrated | **Branch:** `evergreen/openai-v4`

## Scan
10 finding(s) across 2 file(s); 2 files scanned in 19ms.

## Changes
| File | Rules | Status | Confidence | Summary |
|---|---|---|---|---|
| `src/assistant.js` | openai-v4-001, openai-v4-002, openai-v4-003 | migrated | 0.93 | Replaced the Configuration/OpenAIApi import and construction with `import OpenAI from "openai"` and `new OpenAI({ apiKey })`. Renamed createChatCompletion/createCompletion/createEmbedding to chat.completions.create/completions.create/embeddings.create with the same arguments, and removed one `.data` level from each response access, since v4 returns the payload directly. |
| `package.json` | openai-v4-001 | migrated | 0.95 | Raised the openai dependency from ^3.3.0 to ^4.0.0, as rule openai-v4-001 requires. This file is outside the work list and was edited only because the rule explicitly asks for it to be updated and recorded here. |

### Agent notes
The lockfile was not touched, so run npm install to refresh it. Error handling is different in v4: failed calls now throw OpenAI.APIError instead of axios errors. No callers in this file inspected error shapes, but code that calls these functions should be checked if it reads err.response.

## Triage (FR-03.2)
| Location | Rule | Verdict | Reason |
|---|---|---|---|
| `src/assistant.js:1` | openai-v4-001 | affected | Named imports Configuration and OpenAIApi no longer exist in openai v4. |
| `src/assistant.js:3` | openai-v4-001 | affected | The Configuration class was removed in v4; the client is constructed directly with new OpenAI({ apiKey }). |
| `src/assistant.js:4` | openai-v4-001 | affected | OpenAIApi was removed in v4 and must be replaced by the default OpenAI client class. |
| `src/assistant.js:7` | openai-v4-002 | affected | createChatCompletion is replaced by chat.completions.create in v4. |
| `src/assistant.js:12` | openai-v4-003 | affected | response is the v3 axios wrapper from the openai client, so .data.choices must become response.choices. |
| `src/assistant.js:16` | openai-v4-002 | affected | createCompletion is replaced by completions.create in v4. |
| `src/assistant.js:21` | openai-v4-003 | affected | response comes from the v3 createCompletion call, so the .data indirection is removed in v4. |
| `src/assistant.js:25` | openai-v4-002 | affected | createEmbedding is replaced by embeddings.create in v4. |
| `src/assistant.js:29` | openai-v4-003 | affected | The embeddings response is the v3 axios wrapper, so the .data.data[0] indirection must become data[0] in v4. |
| `src/tickets.js:16` | openai-v4-003 | not_affected | The payload comes from a fetch() call to an internal analytics API, not from the openai client, and the code comment marks it as a decoy. |

## Verification
`node --check src/assistant.js && node --check src/tickets.js` → exit 0
```

```

## Rules applied
### openai-v4-001 — Configuration/OpenAIApi replaced by the OpenAI client class [breaking]
In openai-node v4, the Configuration + OpenAIApi pair was removed. The SDK exports a default OpenAI class constructed directly with options: `new OpenAI({ apiKey })`. Named imports `Configuration` and `OpenAIApi` no longer exist.
**Before:**
```
import { Configuration, OpenAIApi } from "openai";
const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);
```
**After:**
```
import OpenAI from "openai";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```
Docs: https://github.com/openai/openai-node/blob/master/MIGRATION.md

### openai-v4-002 — createX methods replaced by resource namespaces [breaking]
v4 moved every createX method onto resource namespaces: createChatCompletion → chat.completions.create, createCompletion → completions.create, createEmbedding → embeddings.create, createImage → images.generate. Request params are unchanged for chat/completions/embeddings.
**Before:**
```
const response = await openai.createChatCompletion({ model, messages });
```
**After:**
```
const completion = await openai.chat.completions.create({ model, messages });
```
Docs: https://github.com/openai/openai-node/blob/master/MIGRATION.md

### openai-v4-003 — Axios response wrapper removed — no more .data indirection [breaking]
v3 returned axios responses, so payloads lived under `.data` (e.g. `response.data.choices`, and embeddings doubly nested as `response.data.data[0]`). v4 returns the API payload directly: `completion.choices`, `embedding.data[0]`.
**Before:**
```
return response.data.choices[0].message.content;
```
**After:**
```
return completion.choices[0].message.content;
```
Docs: https://github.com/openai/openai-node/blob/master/MIGRATION.md

## Run economics
Tokens — input: 10 | cache read: 1,92,635 | cache write: 33,355 | output: 2,899 — inference cost $0.2633

## Review checklist
- [ ] Diff touches only expected files
- [ ] Parameter/return-shape mappings match the vendor guide
- [ ] Tests pass locally
- [ ] Skipped locations handled manually (if any)

*Generated by Evergreen. PRs, never pushes — a human merges.*
