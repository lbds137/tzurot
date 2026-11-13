---
id: TASK-1421
title: 'PR 2750 round-2 residue: cache-key scoping + claim pins'
status: To Do
assignee: []
created_date: '2026-11-13T10:00:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1421000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Round-2 claude-review found no blocking defects; the Medium efficiency finding and the Low/Info quality items are dispositioned into this task. Core: scope the sessionId cache-key row to configs where the caching gate fires so non-anthropic conversation models stop fragmenting the instance LRU, with a non-anthropic key-shape test. Full checklist in the file.
<!-- SECTION:DESCRIPTION:END -->

## Checklist (round-2 claude-review findings, none release-blocking)

- **Core (Medium, efficiency)**: scope the `sessionId` cache-key row to configs where the caching gate fires — `cacheVal(gate ? modelConfig.sessionId : undefined)` in `CacheKeyBuilder.ts` (gate = `promptCaching === true && isAnthropicFamilyModelId(modelName)`), or normalize at the source in `modelInvocation.ts`. Today every non-anthropic conversation model (GLM, Gemini, GPT) builds one instance per channel whose `sessionId` is never sent, pressuring the 500-entry LRU. Add a non-anthropic key-shape test (key identical with vs without `sessionId` when the gate is off); the anthropic differ-tests stay green.
- (Low) Restore `satisfies ChatModelResult` on the hoisted `stubCreateChatModel` in `LLMInvoker.test.ts` — dropped in the round-1 hoisting refactor; it was the compile-time guard on the stub's shape (keep the `as any` on `model`).
- (Low) Pin or hedge the cache-behavior claims in `LLMInvoker.getModel` — "a hit refreshes its TTL" and the 500/4h LRU bound. Either inject cache options/`now` for a fake-timer test (TTLCache supports `now`, `TTLCache.ts:47-56`) or soften the comments.
- (Low) Reword the hashed-id comments (`modelFactory/types.ts`, `modelInvocation.ts`): `contentDigest` is pseudonymization, not anonymization — say "avoids shipping the raw id; not a secrecy boundary". (A keyed HMAC would give unlinkability but needs a deploy-stable secret — decide if ever wanted.)
- (Info) One sentence in the `modelInvocation.ts` comment: `session_id` is per CHANNEL, spanning personalities and users in that channel, deliberate — affinity only picks an endpoint; prefixes stay separate per system prompt. Mix `personality.id` into the digest input only if TASK-1414 data ever shows per-personality affinity reading better.
- (Info) In the `attachSystemBlockBreakpoint` JSDoc: cite https://openrouter.ai/docs/features/prompt-caching inline and soften "never" (Anthropic auto mode also lookback-scans earlier blocks).
- (Nit) Inline `MODEL_CACHE_OPTIONS` at the field initializer (one-use wrapper).
- (Optional, observability) Add `sessionIdInjected` / `systemBreakpoint` booleans to the cache-observability `Generated response` line — the first lever if TASK-1414 prod data shows post-deploy misses, separating "affinity applied but still missed" from "gate did not fire".
