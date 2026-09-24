---
id: TASK-1075
title: Attachment arbitrary never generates flagged non-audio voice attachments
status: To Do
assignee: []
created_date: '2026-09-24 05:53'
labels:
  - 'area:test-utils'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 1068000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1069 makes a non-audio attachment (the Vencord video/webm voice message) a voice message when its parent message carries IsVoiceMessage and it has a duration. attachmentArb in packages/test-utils/src/jobContextArbitraries.ts never generates that state, and packages/test-utils/src/jobContextArbitraries.test.ts:62 pins it (attachmentArb never flags a non-audio attachment as a voice message), so property tests over job contexts never exercise a voice message with a non-audio content type.
Fix shape: widen the arbitrary to emit flagged non-audio voice attachments (video/webm, isVoiceMessage true, a duration), replace the pinned invariant with the new classification rule, and fix any consumer property test the widening reddens.
Acceptance: the arbitrary generates the state and the property suites are green.
Depends on: TASK-1069 merging (the classification rule lands there).
<!-- SECTION:DESCRIPTION:END -->
