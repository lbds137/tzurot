---
id: TASK-1004
title: >-
  Recent-days digest: a pair that fails generation is re-eligible on the very
  next tick with no backoff
status: To Do
assignee: []
created_date: '2026-09-17 23:20'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 1000000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why (premise corrected 2026-09-18 by the TASK-1007 read): a billed failure leaves generated_at null, so the INTERVAL group of the selection query (packages/common-types/src/services/recentDaysDigestSelection.ts) never holds a failed pair back — but that group is AND-ed with the re-admission group, and the failure write always stamps source_watermark with the attempted watermark, so a QUIET failing pair (no new rows, no refresh stamp) is not re-selected at all; the "three consecutive ticks then dead" shape in the original text does not occur. The pair that IS re-billed every tick is an ACTIVE one: each new source row moves the watermark, which re-admits the pair AND resets digest_attempts to 1 on the next failure, so a chatting pair whose digests always fail is billed twice per tick for as long as the chat continues and never reaches dead (observed on dev 2026-09-18: TASK-1007 closed the refresh-stamp variant of the same loop; this task now owns the moving-watermark variant). Under load that also delays healthy pairs by occupying per-tick slots. The roster-blurb sweep has exponential backoff keyed on its last-failed stamp; the digest table has no last-failed column. Reviewer finding on PR #2445 round 2, accepted as a conscious simplicity tradeoff at ship.
Watch signal: the sweep log line "Recent-days digest sweep complete" with failedBilled or dead above zero on consecutive ticks while selected equals MAX_GENERATIONS_PER_SWEEP (the cap is binding). Close by filing the fix when that shape is observed, or archive after a quiet month of prod ticks.
Fix shape: stamp digest_last_failed_at on the failure write (one additive migration) and gate the selection query on now >= last_failed_at + interval * power(2, attempts - 1), mirroring rosterBlurbSweep.ts findStale. Update the selection component test with a backed-off fixture (the file's fixtures now run a–n; pick fresh letters). Note for the design: digest_attempts resets to 1 whenever the watermark moves (recordDigestFailure's CASE), so a backoff keyed on attempts alone never grows for an active pair — key it on last_failed_at with a per-pair counter that survives watermark moves, or on last_failed_at alone.
<!-- SECTION:DESCRIPTION:END -->
