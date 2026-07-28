---
id: TASK-156
title: hasVoiceAttachment keeps a parallel forwarded-snapshot walk
status: To Do
assignee: []
created_date: '2026-06-23 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'area:voice'
  - 'size:S'
dependencies: []
priority: low
ordinal: 156000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`VoiceTranscriptionService.hasVoiceAttachment` keeps a parallel forwarded-snapshot detection path

**Why:** After PR #1309's `isVoiceAttachment` consolidation, `hasVoiceAttachment` still detects forwarded-snapshot voice via its own `snapshotHasAudio` (calls `isVoiceAttachment` on raw snapshot attachments) rather than delegating to `forwardedMessageUtils.hasForwardedVoiceAttachment` (which reads the precomputed `isVoiceMessage` flag). Both call `isVoiceAttachment` today so they agree, but it's a parallel implementation — exactly the drift shape #1309 just eliminated elsewhere. **Fix shape**: have `hasVoiceAttachment`'s forwarded branch delegate to `hasForwardedVoiceAttachment(message)` (note the two paths use different mechanisms — raw `some(isVoiceAttachment)` vs the `isVoiceMessage` flag — so reconcile carefully; they currently agree on the omitted-content-type case but verify). **Promote when**: next touching `VoiceTranscriptionService.hasVoiceAttachment`, OR either snapshot-detection path changes. Surfaced 2026-06-23 by PR #1309 final claude-review (Finding 2, non-blocking).
<!-- SECTION:DESCRIPTION:END -->
