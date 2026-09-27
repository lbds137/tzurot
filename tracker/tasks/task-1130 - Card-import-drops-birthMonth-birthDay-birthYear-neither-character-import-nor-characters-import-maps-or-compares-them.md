---
id: TASK-1130
title: >-
  Card import drops birthMonth/birthDay/birthYear: neither /character import nor
  characters:import maps or compares them
status: To Do
assignee: []
created_date: '2026-09-27 18:06'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1123000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: buildImportPayload (common-types utils/characterImportPayload.ts) has no birth fields, and PersonalityCreateSchema carries none either (birth fields appear only in the full/response schemas in schemas/api/personality.ts), so a card carrying birthMonth/birthDay/birthYear has them stripped silently. characterImportPayload.test.ts pins the strip. Effects: an import never updates or reports the birth fields (an existing row keeps its stored values, since update leaves absent fields alone), and a card that CREATES a new character loses them. Today one card carries them (rich-fairbank-meshavesh-astrategi, taken from its DB row, so no data is at risk yet).

What: map the three fields in buildImportPayload, accept them in the create/update schemas if the routes do not already, include them in the classify diff, and flip the strip test.

Acceptance: a card with birth fields creates them, updates them when they differ, and reports them as changed in a characters:import dry run.
<!-- SECTION:DESCRIPTION:END -->
