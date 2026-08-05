---
id: TASK-443
title: Collapse hasVoiceAttachment onto forwardedMessageUtils.hasVoiceAttachments
status: To Do
assignee: []
created_date: '2026-08-05 23:47'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 443000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: after #1984 delegated the forwarded branch, VoiceTranscriptionService.hasVoiceAttachment is direct-OR-forwarded — which is what forwardedMessageUtils.hasVoiceAttachments (plural) already does. The method could collapse to a one-line delegation, deleting the last of the parallel implementation that #1309 and #1984 have been chipping at. Raised by the #1984 round-2 review.

Why it was NOT ridden along in #1984: the equivalence depends on ordering. The delegation is safe only because the direct check runs FIRST — hasForwardedVoiceAttachment guards on the weaker isForwardedMessage and falls through to reading the MAIN message attachments, so it is a different input set that is only harmless once hasDirectAudio has already cleared it. Collapsing removes that ordering guarantee from the call site, and hasVoiceAttachments has two independent production consumers (ReferenceExtractor.ts, MessageContextBuilder.ts) that must be checked against the same argument.

Member (b), same file, ride along: VoiceTranscriptionService.test.ts now carries three near-duplicate "as any" monkey-patches building mock discord.js Collections. A small createMockCollection helper covering values/first/some would remove them. Filed here rather than as its own row because this task is what opens that file.

Acceptance: hasVoiceAttachment is a one-line delegation OR the task records why the two cannot be unified; both hasVoiceAttachments consumers verified against the ordering argument; the mock-Collection monkey-patches replaced by one helper.
<!-- SECTION:DESCRIPTION:END -->
