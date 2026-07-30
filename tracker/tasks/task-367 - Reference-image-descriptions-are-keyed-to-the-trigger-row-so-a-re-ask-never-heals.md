---
id: TASK-367
title: >-
  Reference image descriptions are keyed to the trigger row, so a re-ask never
  heals
status: To Do
assignee: []
created_date: '2026-07-30 23:08'
labels:
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 367000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-30 by TASK-364; owner screenshot is the runtime proof.** After the images failed to render, the owner asked the character "can you see them now?" and it still reported only URLs. The issue does NOT self-heal.

**Mechanism:** `persistReferenceDescriptions` writes descriptions into the TRIGGER row's `referencedMessages[].resolvedImageDescriptions`. A later reply to the SAME referenced message is a different trigger row, so the lookup finds nothing and the work is redone (or lost again). Descriptions are keyed to the asker, not to the thing described.

**Fix shape (Kimi K3 and Qwen 3.7 Max proposed this independently):** re-key description persistence to the REFERENCED message id (or the attachment content hash) rather than only the trigger row. One source of truth for all renderers, and cross-trigger caching falls out for free — a second reply to the same message should cost 0s, not another 47.8s.

Qwen adds a latency win on top: check dedup state EARLY, read the cache BEFORE running vision. First reference pays; every repeat is free.

**Related smell, same investigation:** the 4 vision calls appear to run serially (47.8s for 4 images). Parallelising them is an independent, straightforward win — file/verify separately if confirmed.

## SHARPENED 2026-07-30 while building #1877 — the stated mechanism is UNDERSTATED

The filed mechanism ("descriptions land on the trigger row, so a later trigger
misses them") assumes the trigger row carries `referencedMessages` at all. It
does not, on the reply path. **The persistence is inert, not mis-keyed.**

Established by exhaustive static enumeration (not inference — the whole call
graph is two sites):

- `writeReferenceImageDescriptions`
  (`packages/conversation-history/src/referenceImageDescriptions.ts:99`) reads
  `metadata.referencedMessages` off the most recent user row and returns 0 when
  it is absent. That early return has **no log line** — the same silence as the
  render-side drop.
- The only writer of that field on a trigger row is bot-client's
  `convertToStoredReferences` (`ConversationPersistence.ts:271`), reached only
  via `saveUserMessage`'s optional `referencedMessages` option.
- `saveUserMessage` and `saveUserMessageFromFields` have exactly **two**
  production call sites between them —
  `character/PersonalityChatManager.ts:168` and `character/characterTurn.ts:239`
  — and **neither passes `referencedMessages`**. PersonalityChatManager says so
  outright: _"References are NOT persisted bot-client-side: the worker
  re-derives them from `rawReferencedMessages` in the envelope."_ (removed as a
  no-op in `67b33a08a`).

So `convertToStoredReferences` and the `referencedMessages` save option are dead
code, `resolvedImageDescriptions` is never populated for a reply-shaped
reference, and `persistReferenceDescriptions` — written precisely to stop "a
quoted image renders as a bare `[image/type: name]` marker on replay" — has been
writing nothing on this path. Non-reply link references still get
`referencedMessages` set at `DiscordChannelFetcher.ts:468`, so the machinery is
not dead everywhere; it is dead for the shape the owner uses daily.

**Confidence:** the call-graph enumeration is static and complete, so "no code
path passes this argument" is a fact. What is NOT runtime-confirmed is the DB
state: rows written before `67b33a08a` may still carry the field, so "the column
is empty" is a claim a query should settle before anyone acts on it.

**Consequence for #1877:** fix-site 3 (stored deduped branch renders
`resolvedImageDescriptions`) is correct and stays — but it has no data to render
for reply references until this task lands. The user-visible fix for the owner's
workflow is the LIVE path, which renders from preprocessing and works today.

**Consequence for this task's fix shape:** "re-key persistence" understates the
work — the durable store has to be built, not moved. That points at the same
artifact doc-55 PR-2 already proposed for stickers: a table keyed by the ASSET
(attachment/sticker identity), not by any conversation row. One store, both
consumers, cross-trigger reuse for free. **Worth an owner call before building**
— it is a schema addition and the convergence with doc-55 PR-2 is a design
decision, not a technical detail.
<!-- SECTION:DESCRIPTION:END -->
