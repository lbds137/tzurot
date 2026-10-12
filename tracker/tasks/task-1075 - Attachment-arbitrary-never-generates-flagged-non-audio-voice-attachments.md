---
id: TASK-1075
title: Attachment arbitrary never generates flagged non-audio voice attachments
status: To Do
assignee: []
created_date: '2026-09-24 05:53'
updated_date: '2026-10-12 22:50'
labels:
  - 'area:test-utils'
  - 'size:S'
  - 'state:ready'
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


Update 2026-10-12: the blocker is cleared. TASK-1069 is Done and merged in #2499 (a9f3c3d87 on develop, 2026-09-24; cited by TASK-1076), so the classification rule this task depends on has landed. State moved from dependent to ready.
<!-- SECTION:DESCRIPTION:END -->
