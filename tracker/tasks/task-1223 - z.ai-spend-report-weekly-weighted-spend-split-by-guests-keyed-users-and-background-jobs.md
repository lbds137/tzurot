---
id: TASK-1223
title: >-
  z.ai spend report: weekly weighted spend split by guests, keyed users and
  background jobs
status: To Do
assignee: []
created_date: '2026-10-13 01:07'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1212000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the owner wants to size the fleet z.ai reserve from Tzurot usage (via Deck, 2026-10-12). Question to answer: Tzurot weekly z.ai weighted spend, split by guests, keyed users and background jobs. Owning theme: doc-12 P1.2 (usage_logs + pnpm ops telemetry:inference).

Verified 2026-10-12 (code read, Explore pass): five usage_logs writers exist: chat llm_generation (AIJobProcessor.ts:437), fact_extraction (FactExtractionService.ts:317), roster_blurb (rosterBlurbSweep.ts:258), archive_summary (archiveSummaryUsageLog.ts:41), recent_days_digest (recentDaysDigestUsageLog.ts:28). The suspected unlogged memory consolidation job does not exist: the owner meant fact distillation (fact_extraction) and turn summarization (archive_summary), both logged. Split columns: requestType separates chat from background; on chat rows byok true = own key, false = guest/free. provider separates zai-coding from openrouter.

Gaps that affect this answer:
1. Background rows carry byok NULL, so which key paid (system plan vs a user key) is implied only by provider and the extractionProvider setting at the time.
2. Chat rows hold only the final response tokens; retries, quota retargets and fallbacks inside a turn are not summed (inference from modelInvocation.ts and GenerationStep.ts, not runtime-confirmed).
3. The digest dry run bills the model and writes no row (recentDaysDigestDryRun.ts). Persona-less archive summaries write no row: TASK-995.
4. z.ai weighting: usage_logs stores raw tokens; the plan weighting per model must be applied in the report.

What: extend telemetry:inference (or a sibling) with a weekly z.ai section: provider = zai-coding, grouped by requestType and, for chat, byok; apply the plan weights; state the unmeasured spend (gaps 2-3) beside the totals. Decide whether gap 2 needs a code fix (sum all attempt tokens into the chat row).

Acceptance: one command prints last-7-day z.ai weighted spend in three buckets (guests, keyed users, background by requestType) for prod, read-only, and the output names what it cannot see.
<!-- SECTION:DESCRIPTION:END -->
