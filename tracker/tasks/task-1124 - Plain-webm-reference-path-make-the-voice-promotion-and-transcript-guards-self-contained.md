---
id: TASK-1124
title: >-
  Plain-webm reference path: make the voice promotion and transcript guards
  self-contained
status: To Do
assignee: []
created_date: '2026-09-27 13:22'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1117000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2548 (TASK-1116) review rounds 3-4 left three low-severity hardening items in the plain audio-only webm reference path, all correct today:

1. `QuoteFormatter.ts` `renderableFor` promotes a plain `video/webm` with ANY description to the voice arm; it relies on its callers (`buildDedupedAttachments`, `buildStoredAttachments`) to have filtered File-typed / non-voice enrichment first. The `describe` callback passes a bare string, so the renderer cannot check the source kind itself.
2. `AttachmentProcessor.ts` repeats the usable-preprocessed-transcript predicate (non-empty description, not AttachmentType.File) in `processVoiceAttachment` and `processPlainFileAttachment`; extract one named predicate.
3. An own-persona plain webm short-circuits to OWN_VOICE_DESCRIPTION without a sniff, so a real A/V own-persona upload would render as own voice (consistent with voice-flagged own-persona handling; personas only emit TTS audio today).

What: let `describe` return the enrichment kind with the text (or add a kind-aware variant) so `renderableFor` promotes only voice/Audio-sourced descriptions; extract the predicate; pin item 3 with a test either way (document the decision).

Acceptance: the promotion is correct with the upstream File filter removed (a test proves it); one predicate definition; an own-persona A/V plain webm case is pinned by a test.
<!-- SECTION:DESCRIPTION:END -->
