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
work — the durable store has to be built, not moved.

## COUNCIL 2026-07-30 — the asset table was PROPOSED, SPLIT, and REJECTED

My first read pointed at an asset-keyed table converged with doc-55 PR-2's
sticker table. Councilled, it split 2-1 FOR that table (GLM 5.2, Qwen 3.7 Max)
against Kimi K3, who argued the durable store already exists — **the history
row** — and that the write was abandoned mid-relocation. Tiebreaker (Gemini 3.1
Pro, both positions verbatim) backed Kimi **decisively**. Resolved on merit, not
vote count, because two verified facts post-dated the split:

1. **The table does not remove this task; it is strictly additive.** Both
   majority designs assume a hydrator reads the table at replay — but
   `hydrateStoredReferences` iterates `messageMetadata.referencedMessages` to
   learn WHICH references exist. The table would supply descriptions and not the
   reference's existence, author, timestamp, or text. Gemini: *"Position A is not
   an alternative solution; it is strictly additive work that fails to solve the
   core architectural disconnect."*
2. **Qwen's economic case does not hold as stated.** On replay there is no vision
   job: the hydrator reads the 1h Redis canonical and, on miss, renders a bare
   marker. Expiry causes DEGRADATION, not re-payment. Re-payment needs a NEW
   reply to the SAME image later — common for stickers (globally shared),
   uncommon for attachments (one message). That asymmetry is exactly why doc-55's
   sticker table earns its keep and an attachment table does not.

**THE FIX (accepted): complete the abandoned relocation.** The worker persists
the references it built — descriptions inline in
`messageMetadata.referencedMessages[].resolvedImageDescriptions` — into the
history row. `persistReferenceDescriptions` stops being read-back-and-patch and
becomes write-what-you-built, so **the same function builds what is rendered and
what is stored and the two cannot drift**. That property, not any test, is what
kills the class.

Why this shape wins on the beta.110 lesson specifically: durability makes three
things permanent, not one — persisted failures, unstable keys, and absent
lifecycle. Inline persistence has **no key dimension at all** (no derivation at
replay, no urlHash fallback, no miss mode; absence means "never computed," which
is retryable, never "lookup failed") and **inherits retention for free**
(description lifetime = history lifetime; an asset table would keep describing
deleted images forever and need a sweep nobody has written).

Share with doc-55 PR-2 **policy, not schema** — successes-only, tier promotion,
`deriveAttachmentCacheKey`. Precedent: the vision and voice caches already share
key derivation and nothing else. doc-55 PR-2 ships unchanged, on its own terms.

**Accepted cost:** descriptions freeze at the model that produced them; a better
vision model later does not upgrade old rows. Replay needs a quality floor, not
a ceiling.

**Revisit condition (Gemini, verbatim in spirit):** if telemetry shows a high
volume of NEW replies to OLD (>1h) attachments — continuous canonical-cache
misses re-paying vision on the live path — the low-reuse assumption is falsified
and a snowflake-keyed table becomes worth building purely as cost dedup.

**Sequencing: TASK-365 FIRST, then this.** Persisting before the projection
refactor would persist a shape 365 is about to replace.

**Test shape this task needs (Kimi):** a ROUND-TRIP test — save → replay →
sentinel appears. Field-parity tests structurally cannot catch "nothing writes
this field," which is exactly how this went unnoticed; only a round-trip can.
Given prod-as-soak and a currently-inert stored path, that test is the only
coverage this path will ever get.

**Also fixed by construction here:** the stored path has no persisted
voice-transcript field (`storedReferencedMessageSchema` carries
`resolvedImageDescriptions` only), so a stored reference's transcript never
survives replay. Writing the built reference resolves this the same way it
resolves images. Surfaced by #1877's round-2 review.
<!-- SECTION:DESCRIPTION:END -->
