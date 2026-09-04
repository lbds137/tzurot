---
id: TASK-840
title: >-
  Eval whether splitting the S0 media-provenance constraint lands better than
  the mid-sentence carve-out
status: To Do
assignee: []
created_date: '2026-08-31 13:59'
updated_date: '2026-09-04 19:38'
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

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. no eval or split has been done; the constraint is still one dense sentence with the link-preview carve-out sitting mid-sentence, exactly as described. Evidence: `git grep -n "not participant-shared\|Link preview" services/ai-worker/src/services/prompt/HardcodedConstraints.ts` → single `<constraint>` block (line 124) still carries the general provenance rule and the link-preview carve-out together.
---
<!-- COMMENTS:END -->
