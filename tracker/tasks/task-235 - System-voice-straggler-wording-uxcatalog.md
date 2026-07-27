---
id: TASK-235
title: 'System-voice straggler wording → ux/catalog'
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
labels:
  - 'area:voice'
dependencies: []
ordinal: 235000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

System-voice straggler wording → ux/catalog — Non-command error surfaces still using raw literals (no behavior change, pure wording): STT ×3 (`VoiceTranscriptionService.ts:350-354`, 'Sorry, transcription…'), `MessageHandler.ts:129-130` top-level catch ('Sorry, I encountered an error…'), truncation notices (`multiTagDeliveryFlow.ts` tag-count `_(Only the first N…)_`, `DiscordResponseSender.ts:382-387` TTS over-size). None have a personality in scope (system-register only). Route through `CATALOG.*`/`renderSpec` for one emoji map + wording discipline. **Why deferred**: owner split PR-E (#1561) to keep the feature review focused on the multi-tag behavior change. **Promote when**: a wording-polish pass, or the catalog gains a system-register straggler intent. Surfaced 2026-07-08 (PR-E scoping).

**Why:** Consistency of the non-command error surfaces with the swept command surfaces.
<!-- SECTION:DESCRIPTION:END -->
