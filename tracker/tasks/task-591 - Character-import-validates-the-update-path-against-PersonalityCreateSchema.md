---
id: TASK-591
title: Character import validates the update path against PersonalityCreateSchema
status: To Do
assignee: []
created_date: '2026-08-13 18:56'
updated_date: '2026-09-04 19:39'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 591000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: handleImport runs validatePayloadFields (import.ts, PersonalityCreateSchema.safeParse) at step 5, BEFORE checkExistingCharacter at step 6 decides create-vs-update. So a re-import over an existing character is pre-validated client-side against the CREATE schema and then sent to updatePersonality. Currently inert: REQUIRED_IMPORT_FIELDS guarantees name/slug/characterInfo/personalityTraits are present, which is the only axis on which Create is stricter than Update today. It becomes a live bug the moment Create gains a constraint Update lacks - a legitimate update payload would be rejected client-side by the wrong schema, with a field-error message the gateway would never have produced.

Fix shape: not the one-liner it looks like. Validating before touching the API is deliberate, so schema selection needs either (a) moving validation after checkExistingCharacter - which changes error precedence, so a malformed payload for a character the user does not own would surface the ownership error instead of the field list, a UX call - or (b) a second validation pass on the update branch. Pick one deliberately; do not reorder by reflex.

Acceptance: the update path is validated against PersonalityUpdateSchema, with a test asserting a payload valid under Update but invalid under Create reaches updatePersonality; and whichever error-precedence behaviour is chosen is pinned by a test.

Source: 2026-08-13 claude-review round 3 on PR #2090 (TASK-565), non-blocking observation 1.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:39
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): OWNER RULING (C9): ownership wins. Branch on checkExistingCharacter first, then validate against the schema that applies (Create vs Update), so a non-owner sees the ownership error rather than a field error. state:ready.
---
<!-- COMMENTS:END -->
