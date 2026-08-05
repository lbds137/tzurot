---
id: TASK-268
title: Preprocessing jobs lack a spend-idempotency guard on retry
status: To Do
assignee: []
created_date: '2026-07-14 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:voice'
  - 'area:redis'
  - 'area:jobs'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 268000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Preprocessing jobs (STT/vision/shapes wrappers) lack a spend-idempotency guard on stall-requeue — `processLLMGenerationJob` holds a Redis idempotency lock (`markMessageProcessing` on triggerMessageId+personalityId) before the paid call; `processAudioTranscriptionJobWrapper`/`processImageDescriptionJobWrapper` (and the shapes import/export wrappers) call the paid STT/vision API with no check-and-set — a FALSE stall (≥5 min continuous event-loop block or Redis outage, post-#1647) re-queues the job while the original is mid-flight and double-bills the provider (BYOK included). Real stalls (dead process) don't double-bill. Surfaced by #1647 review round 2, which also narrowed the false-stall margin 20min→5min. **Fix shape**: job.id-keyed Redis check-and-set in the preprocessing wrappers (mirror `markMessageProcessing`; these aren't per-personality fan-outs, so job.id suffices). NOTE: the LLM path re-entered this exposure class when its lock became ownership-aware (a false-stall re-run now recognizes its own lock and proceeds — duplicate reply + spend on a false stall, accepted deliberately vs. the swallowed-reply-on-real-stall bug it fixed; real-stall re-runs now deliver). Same tripwire; a fencing token is the complete fix if the trigger fires. Full scope for that fix (review #1799): atomic compare-and-set / compare-and-delete (Lua) closing the GET→SET TOCTOU (a third genuinely-different run can slip past the at-most-2 bound) and the TTL-boundary false-deny (GET null after a lost SET NX); ownership-aware `releaseMessageLock`; plus the two deferred test cases (GET-null-after-NX-miss, concurrent re-acquire ordering). **Promote when**: prod `Job stalled` warns (new #1647 logging — the purpose-built tripwire) show a stall for an STT/vision job whose original was still alive, or any repeat-spend signal on those providers.

**Why:** The tripwire ships before the guard: stalled-event logs make the gap observable, and false stalls need minutes of continuous stall to occur at all. Surfaced 2026-07-14 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
