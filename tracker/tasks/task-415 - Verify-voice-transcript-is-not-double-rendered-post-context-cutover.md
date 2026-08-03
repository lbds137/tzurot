---
id: TASK-415
title: Verify voice transcript is not double-rendered post context-cutover
status: To Do
assignee: []
created_date: '2026-08-03 18:27'
labels:
  - 'size:S'
dependencies: []
priority: high
ordinal: 415000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: contentRewriter.ts docblock gated payload replacement on settling the voice content story ("using the transcript as the message would double it with the attachment-description path"), but ContextStep.ts:84-89 now overwrites job.data.message unconditionally - the cutover shipped through the documented precondition without discharging it. Code-read suggests voice jobs MAY render the transcript twice (message body + attachment description); NOT runtime-confirmed. Surfaced by the 2026-08-03 drift audit.
Fix shape: trace a voice job through ContextStep/assembleCore - does messageContent embed the transcript AND does the attachment path inject it again? Confirm with a dev voice-turn diagnostic (/inspect or ai-worker logs). If doubled, pick the single source and fix; either way rewrite the contentRewriter docblock to state the live contract (left stale deliberately until this investigation lands).
Acceptance: runtime evidence of single-render (close + docblock fix) or a fix PR; docblock states the live contract.
<!-- SECTION:DESCRIPTION:END -->
