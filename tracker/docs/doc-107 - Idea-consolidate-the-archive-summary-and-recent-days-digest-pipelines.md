---
id: doc-107
title: 'Idea: consolidate the archive-summary and recent-days-digest pipelines'
type: other
created_date: '2026-09-18 14:01'
---

### Idea: consolidate the archive-summary and recent-days-digest pipelines

_Focus: one background-summarization shape with two content policies, instead of two mirror-image module trees._

**Owner intake (2026-09-18, the beta.226 cut)**: "These digests, are these duplicative of when we summarize long-term memories? ... I just feel like we have a bunch of summarization logic in place. There might be opportunities for refactoring or deduplication in the future."

**What is NOT duplicative (settled, do not re-litigate)**: the two products answer different questions. Archive summaries condense OLD memories into similarity-retrieved notes; the recent-days digest is a rolling 7-day continuity feed per (persona, personality) over all channels, regenerated every 2 h. The digest design doc (`docs/proposals/backlog/recent-days-digest.md`, §Directives 2 and 5, and the scope line "does not summarize or alter the archive or the facts") records why neither can replace the other, and the doc-8 principle "episodes are the source record; everything above them is derived and rebuildable" is why a digest must never feed memory.

**What IS duplicated (the target)**: the module trees mirror each other file for file —

| archiveSummary (`services/ai-worker/src/services/archiveSummary/`) | recentDaysDigest (`services/ai-worker/src/services/recentDaysDigest/`) |
| --- | --- |
| `ArchiveSummaryProcessor` + `archiveSummaryRound` | `recentDaysDigestSweep` + `recentDaysDigestGeneration` |
| `archiveSummaryPrompt` | `recentDaysDigestPrompt` |
| `archiveSummaryValidation` (first_person, quote stripper — already SHARED, imported by the digest) | `recentDaysDigestValidation` (quotation n-gram, overflow) |
| `archiveSummaryStore` (content-guarded raw-SQL writes) | `recentDaysDigestStore` (`requested_at IS NOT DISTINCT FROM` guard) |
| `archiveSummaryUsageLog` | `recentDaysDigestUsageLog` |
| `makeArchiveSummaryInvoker` | `makeRecentDaysDigestInvoker` |
| `constants.ts` | `packages/common-types/src/constants/recentDaysDigest.ts` |

Already shared at the cut: `first_person` + `stripQuotedSpans` (both fixed at once by #2449), one prompt-context function (#2448), the `zai-coding` route gate, the `invokeSystemModel` call shape.

**Candidate shape (unverified — the reuse-scout pass decides)**: a `SummarizationJob` adapter interface (cohesive per `02-code-standards.md` § adapter-interface exception: prompt builder, validator chain, store writes, usage row, cadence gate) with two implementations, and one shared runner for the invoke → validate → single-regeneration → store → usage-row loop. The 2-callback ceiling applies: if the two runners diverge on more than the adapter seam (e.g. the archive's BullMQ per-row job vs the digest's cron sweep over pairs), leave the runners separate and consolidate only the validator + usage-row + invoker layers.

**Gate to start**: the digest has a few weeks on prod and its shape has stopped moving (no open digest tasks besides TASK-1012/1013/1014's small edges). Then `/tzurot-reuse-scout` over the table above, one PR per consolidated layer.

**Promote when**: the next change that has to be made twice (a validator, a usage-row field, a route gate) — that is the measured cost this idea trades against.
