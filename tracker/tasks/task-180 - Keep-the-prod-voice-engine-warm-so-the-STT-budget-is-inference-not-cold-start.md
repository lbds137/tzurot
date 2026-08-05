---
id: TASK-180
title: 'Keep the prod voice-engine warm so the STT budget is inference, not cold-start'
status: To Do
assignee: []
created_date: '2026-06-27 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:voice'
  - 'area:jobs'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 180000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Keep the prod voice-engine warm so the STT budget is inference, not cold-start

**Why:** The prod voice-engine runs Railway-serverless (sleeps on idle); the first voice message after idle pays a ~23–135s cold-start that stacks on top of the transcription and eats into `STT_GATEWAY` (especially for a long first message). beta.139's chunking + bigger timeouts handle the common case, but cold-start variance remains. **Fix shape**: a keep-warm ping (a BullMQ repeatable job hitting `/health`, or disable the serverless idle policy on the prod voice-engine service) so the engine is hot when a voice message arrives. **Promote when**: post-fix prod logs still show cold-start eating the STT budget (a large gap before `inference_sec` begins), OR a long first-message-after-idle still times out. Surfaced 2026-06-27 by the long-audio STT chunking work (beta.139).
<!-- SECTION:DESCRIPTION:END -->
