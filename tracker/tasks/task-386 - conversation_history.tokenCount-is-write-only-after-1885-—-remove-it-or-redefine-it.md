---
id: TASK-386
title: >-
  conversation_history.tokenCount is write-only after #1885 — remove it or
  redefine it
status: To Do
assignee: []
created_date: '2026-08-01 02:50'
updated_date: '2026-08-14 01:04'
labels:
  - 'size:M'
  - 'area:db'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 386000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`conversation_history.tokenCount` is write-only after #1885 — decide its fate.

**State after #1885**: every consumer that made a DECISION on this column is gone. `ContextWindowManager` and `CrossChannelSerializer` now measure the rendered entry; `calculateMessagesFitInBudget` was deleted (zero callers). What remains is producers and pass-throughs only — verified by `rg '\.tokenCount|tokenCount:' --type ts -g '!*.test.ts'`:

- WRITTEN: `ConversationHistoryService.ts:110` (insert), `ConversationSyncService.ts:263` (sync)
- SELECTED: `ConversationMessageMapper.ts:37,118`
- MARSHALLED: `RawEnvelopeBuilder.ts:113`, `crossChannelEnvironment.ts:58`, `messageNormalization.ts:197`
- READ TO DECIDE ANYTHING: nothing

So we run tiktoken on every message at insert, persist the number, select it in every history query, and carry it through four layers of wire shape, for no consumer.

(`PgvectorMemoryAdapter.ts:215` is a DIFFERENT field on the memory domain — not this column. Don't conflate them when sweeping.)

**Two honest options**:

(a) **Remove it.** Migration to drop the column + strip the field from the mapper, envelope, cross-channel, and normalization shapes. Cleanest, but it's a schema change and a cross-service wire-shape sweep — per 02-code-standards rule 8 that must cover `tests/e2e/` too.

(b) **Make it mean the rendered form** — i.e. store `measureHistoryEntryTokens`'s output instead of `countTextTokens(content)`. This resurrects it as a legitimate cache AND resolves the review note on #1885: `preselectHistory` currently pays a full render+tiktoken pass in `countHistoryTokens` and the selection loop pays another over the same entries, so the cost lands twice per generation. A correct cached value collapses both to zero. BUT the value would then have to be invalidated whenever anything it renders changes (attachment enrichment written later, personality rename, hydration) — which is exactly the cache-as-system-of-record trap doc-56 is about, and the trap TASK-367 just dug us out of.

**Recommendation**: (a). The double-render cost is measured at 24-41ms per 50-entry window against a 5-45s generation, so option (b) buys a rounding error and takes on an invalidation obligation we have been actively removing elsewhere.

**Promote when**: touching the conversation_history schema for another reason (ride it along), or if profiling ever shows the double pass mattering.
<!-- SECTION:DESCRIPTION:END -->
