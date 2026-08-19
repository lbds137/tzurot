---
id: TASK-644
title: >-
  participantDisplayName does not trim its returned value, which also affects
  collision detection
status: Done
assignee: []
created_date: '2026-08-17 21:21'
updated_date: '2026-08-19 18:41'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 644000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: review of #2129 flagged that a preferredName like " Lila" (leading space, non-blank after trim) renders <name> Lila</name> and doubles the space in the new about lead-in ("In  Lila"). The guard added in #2129 trims only for the FALLBACK DECISION, not the returned value.

Why it was NOT fixed in #2129: it looks cosmetic but is not. participantDisplayName also feeds rosterCollidesWithCharacter, which lowercases and compares the rendered display name against the character name. Trimming the returned value changes whether a collision is DETECTED for whitespace-padded names, and therefore whether the roster collision note is emitted into the S1 cache prefix. That is a semantic change to shipped behavior, unrelated to the identity-bleed bug #2129 fixed, and #2129 had already been flagged for one scope expansion into <name> rendering.

Fix shape: trim the returned value in participantDisplayName (services/ai-worker/src/services/prompt/ParticipantFormatter.ts), and decide deliberately whether collision detection SHOULD match whitespace-padded names — pin whichever answer with a test in ParticipantFormatter.test.ts alongside the existing collision cases.

Acceptance: names with stray leading or trailing whitespace render trimmed in <name> and in the about lead-in; the collision-detection behaviour for such names is pinned by a test rather than incidental.
<!-- SECTION:DESCRIPTION:END -->
