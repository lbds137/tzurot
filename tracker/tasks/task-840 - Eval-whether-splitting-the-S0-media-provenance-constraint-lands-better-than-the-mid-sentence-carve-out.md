---
id: TASK-840
title: >-
  Eval whether splitting the S0 media-provenance constraint lands better than
  the mid-sentence carve-out
status: To Do
assignee: []
created_date: '2026-08-31 13:59'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 840000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2270 round-2 review observation (hedged, no failure claimed): the media-provenance constraint in services/ai-worker/src/services/prompt/HardcodedConstraints.ts opens with media "a participant shared" and only later carves out link previews as NOT participant-shared — the carve-out sits mid-sentence in an already dense constraint. The original TASK-837 prod bug was exactly a provenance misread, so ordering may matter; whether it does is an empirical prompt-design question, not a code bug.

Fix shape: split into two constraint elements — the general provenance rule, and a dedicated link-preview/sticker source-attribute rule — then compare via the prompt eval harness (allocation arms) or at minimum a deliberate qualitative pass. The snapshot tests and HardcodedConstraints.test.ts pins move with whatever text ships.

Acceptance: a recorded decision — split shipped with the pins updated, or ruled out with the eval evidence in the removing commit.
<!-- SECTION:DESCRIPTION:END -->
