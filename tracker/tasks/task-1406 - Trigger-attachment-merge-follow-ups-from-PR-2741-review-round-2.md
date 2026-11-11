---
id: TASK-1406
title: Trigger attachment merge follow-ups from PR 2741 review round 2
status: To Do
assignee: []
created_date: '2026-11-11T04:38:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1387000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the second claude-review on PR 2741 (TASK-1395 merge, services/ai-worker/src/jobs/handlers/pipeline/steps/triggerAttachmentMerge.ts) found nothing blocking; per the round-3 cap these minor items ship as a follow-up.
What:
1. FAILURE_CATEGORY, cdnUrlOf, buildFailureStub and buildEmptyTranscriptStub are exported but imported nowhere: drop the exports or test them directly (the kind-to-wording table is covered only indirectly).
2. DependencyStep.fetchAudioResult final warn still says "failed or has no result"; it now fires only for a missing result: reword to "has no result".
3. MergeOptions.audioEmpties is optional while audioFailures is required: make it required (tests pass []).
4. jobContext optionality is mixed in DependencyStep.process (jobContext.attachments vs jobContext?.extendedContextAttachments, persistVisionDescriptions undefined check): pick one.
5. GenerationContext.triggerAttachmentDownloads docstring says undefined when the step found no attachments; it is [] when only extended-context attachments exist: correct the wording and add a test for the empty-recorded-list path (job entries become appended orphans).
6. Add a test that a reference-numbered empty transcript stays out of the trigger (only the failure filter is pinned).
Acceptance: each item done, with a canary for 6.
<!-- SECTION:DESCRIPTION:END -->
