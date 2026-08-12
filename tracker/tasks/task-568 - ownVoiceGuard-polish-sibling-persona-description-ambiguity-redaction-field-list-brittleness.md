---
id: TASK-568
title: >-
  ownVoiceGuard polish: sibling-persona description ambiguity + redaction
  field-list brittleness
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 568000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: (1) OWN_VOICE_DESCRIPTION ("The character’s own voice message...") is persona-agnostic because authorRole=assistant covers siblings too - when persona A quotes persona B’s voice message, A’s prompt copy can read as claiming the audio is A’s own (quote ROLE correctly demotes to character; only the description is ambiguous). Responder-relative phrasing closes it. (2) redactOwnVoiceTranscript rebuilds a fixed field list rather than spread-and-override, so future RenderableVoice identity fields silently drop on the redaction path only; nothing pins the exclusion intent.

Source: 2026-08-12 review, ai-worker LOW-3 PLAUSIBLE / LOW-6 CONFIRMED-mechanism.
<!-- SECTION:DESCRIPTION:END -->
