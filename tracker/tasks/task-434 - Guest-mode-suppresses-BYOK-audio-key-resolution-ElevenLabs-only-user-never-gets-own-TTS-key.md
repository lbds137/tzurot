---
id: TASK-434
title: >-
  Guest mode suppresses BYOK audio-key resolution (ElevenLabs-only user never
  gets own TTS key)
status: Done
assignee: []
created_date: '2026-08-05 03:14'
updated_date: '2026-08-05 13:05'
labels:
  - 'area:ai-worker'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 434000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: AuthStep.resolveAudioProviderKeys is skipped entirely when isGuestMode is true (AuthStep.ts ~303-320, self-described as an intentional v1 coupling "tracked as a follow-up" - but no task existed until this one). A user whose only active key is ElevenLabs/Mistral is a chat guest, so their own audio key is never resolved and TTS/STT falls back to the shared path despite a valid BYOK key. The TASK-416 alignment makes this visible: that user now correctly sees Guest Mode UI while holding a key the system ignores.

Fix shape: decouple audio-key resolution from chat guest-mode - resolve audio provider keys unconditionally (they are provider-scoped lookups, independent of the chat-capable decision), or gate on a voice-specific predicate instead of isGuestMode.

Acceptance: an ElevenLabs-only (or Mistral-only) user gets their own audio key used for TTS/STT while remaining a chat guest; the AuthStep comment stops claiming untracked follow-up status.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in PR #1974 (merged 2026-08-05, three review rounds, zero blocking findings). The outer chat-guest short-circuit was the entire coupling - the per-provider loop already admitted on each provider resolution result. Regression test verified failing pre-fix. Reviewer independently confirmed no system-key leak path (system fallback always self-marks guest) and swept all consumers. Cost follow-up: TASK-439 + the Promise.all fast-follow PR.
<!-- SECTION:NOTES:END -->
