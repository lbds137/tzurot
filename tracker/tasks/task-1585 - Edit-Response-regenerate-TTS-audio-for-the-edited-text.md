---
id: TASK-1585
title: 'Edit Response: regenerate TTS audio for the edited text'
status: To Do
assignee: []
created_date: '2026-11-28T04:52:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1575000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila ruling 2026-11-27 (AskUserQuestion on PR 2833): when a reply that carried TTS voice audio is edited, regenerate the audio from the edited text and reattach it, instead of only removing it. PR 2833 ships the removal (stale audio would speak the old text).
What: after a successful Edit Response on a reply that had a TTS attachment, run TTS on the new text through the normal per-user TTS path (same billing and BYOK rules as a generation) and attach it to the last chunk.
Acceptance: editing a voiced reply leaves a voice attachment that speaks the new text; an unvoiced reply stays unvoiced; TTS failure leaves the text edit intact and says so.
<!-- SECTION:DESCRIPTION:END -->
