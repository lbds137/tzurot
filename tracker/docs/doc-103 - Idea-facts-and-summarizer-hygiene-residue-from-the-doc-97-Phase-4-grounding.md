---
id: doc-103
title: 'Idea: facts and summarizer hygiene residue from the doc-97 Phase 4 grounding'
type: other
created_date: '2026-09-16 20:19'
---


_One pass, one PR: the low-priority residue the 2026-09-16 grounding agents found while reading the facts and archive-summarizer code for the doc-97 Phase 4 design. Each item is a read-only finding with a cite in the gitignored grounding reports (`docs/local/handoffs/ground-doc97p4-{A,B,C,D}-*.md`); none is runtime-confirmed. Sweep them together when someone next touches these modules; each alone is under the tracker's admission bar._

- **`summary_model` records the first call's model** even when a regeneration produced the stored text, contradicting its own schema comment (`archiveSummaryStore.ts`).
- **`memory:summarize` default `--limit 5000` vs the global daily cap 2000**: the sweep enqueues 2.5× what a day can bill and the surplus delays for hours with no warning. Print the cap and the enqueued count side by side.
- **The `zai-coding` route gate** delays a misconfigured `extractionProvider` 10 min per job and logs at most once per hour, so a misconfiguration reads as a permanently stalled queue.
- ~~**Cross-channel turns lose all metadata** in `mapCrossChannelToApiFormat` (`crossChannelEnvironment.ts:52-66`): a reply-with-image renders as bare text.~~ Resolved by TASK-733: the mapper now forwards `discordMessageId`, `isForwarded`, and the persisted `messageMetadata`, and `crossChannelMessageSchema` declares them.
- **DMs are eligible cross-channel sources with no guild filter** while the current-channel path has an `isolatedDm` mechanism; the asymmetry is documented only in dashboard help text. Design input for Phase 4, otherwise a docs fix.
- **`memory_facts.pool` is inert**: neither prompt query filters `pool` or `is_fiction` although prose claims "the private pool"; `is_fiction` is the live half. Fix the prose or the query.
- **A correction copies the old tags forward verbatim** and exposes no tag editing, so a correction cannot recategorize a fact.
- **`tier='inferred'` is declared everywhere and written nowhere.**
- **`/memory forget` is revivable by a colliding correction**, deliberate and documented at `memoryFacts.ts:220-225`, but the schema comment at `prisma/schema.prisma:1007-1009` says the opposite. Align the schema comment.
