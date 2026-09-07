---
id: TASK-906
title: >-
  Stale-version summary rows re-enqueue on every retrieval until the refresh job
  runs
status: To Do
assignee: []
created_date: '2026-09-07 15:02'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 904000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the retrieval-time lazy enqueue (slice B2) stamps summaryRefreshEligible for done and dead rows whose summary_prompt_version is behind the constant. ArchiveSummaryTrigger.enqueue keeps done and dead status unchanged in its CASE (services/ai-worker/src/services/archiveSummary/ArchiveSummaryTrigger.ts, the UPDATE memories CASE), so the row stays eligible on every retrieval until the processor writes the new version. BullMQ dedups the job by id, so this is not spend: it is one UPDATE (summary_requested_at) plus one no-op queue.add plus one info log line per retrieval of a hot memory during the window after a prompt-version bump, and the window stretches while the job sits delayed behind the model switch or the daily cap. Surfaced by claude-review round 4 on #2352; hypothesized cost, not measured.
Fix shape: for dead rows the trigger CASE may flip a stale-version dead row to pending (nothing renders from a dead row, so the status change is invisible and re-admission stays correct); done rows must stay done so the old summary keeps rendering, so their churn needs a different limiter, for example the eligibility stamp skipping rows whose summary_requested_at is within the last hour (adds the column to both retrieval SELECTs) or the trigger skipping its UPDATE when queue.add returned an existing job. Pick one after measuring the re-enqueue log line during the first real version bump.
Acceptance: after a prompt-version bump, a hot stale-version row logs at most one retrieval re-enqueue per job lifetime; the done row keeps rendering its old summary throughout.
Promote when: the first ARCHIVE_SUMMARY_PROMPT_VERSION bump is planned, or the Archive summary retrieval re-enqueue log line repeats for the same memoryIds.
<!-- SECTION:DESCRIPTION:END -->

Same class on the sweep side (claude-review round 6 on PR 2358): pnpm ops memory:summarize re-selects stale-version done and dead rows on every re-run until their in-flight job completes, because the sweep's pending stamp leaves done and dead untouched by design; the deterministic jobId makes each re-add a no-op, so the cost is selection noise and part of the hot budget during the drain. Whatever limiter closes the retrieval side (the summary_requested_at recency check is the natural one) should be shared with the sweep's ELIGIBLE_PREDICATE, which is that predicate's twin.
