---
id: TASK-565
title: >-
  Character export omits empty tags so re-import cannot restore the untagged
  state
status: To Do
assignee: []
created_date: '2026-08-12 22:34'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 565000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: buildExportData omits tags when the array is empty (deliberate, the list-valued analogue of empty-string omission) and buildImportPayload maps absent -> undefined -> gateway leaves stored tags untouched. Consequence: export an untagged character, tag it later, re-import the old JSON as a restore - the tags silently survive. The clear form ([] clears) exists in the update schema; the export just never emits it. Related: CHARACTER_JSON_TEMPLATE ships realistic-looking "tags": ["fantasy","sci-fi"] where every other template value is self-describing placeholder prose - a user ignoring that line imports two tags they never chose.

Fix shape: export tags: [] explicitly (it IS meaningful), or document the asymmetry; make template values placeholder-shaped.

Acceptance: export/import round-trip restores the untagged state. Source: 2026-08-12 review (tags reviewer F6/F8, CONFIRMED).
<!-- SECTION:DESCRIPTION:END -->
