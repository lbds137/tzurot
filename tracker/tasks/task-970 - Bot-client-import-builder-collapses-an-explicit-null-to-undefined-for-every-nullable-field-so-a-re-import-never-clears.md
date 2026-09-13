---
id: TASK-970
title: >-
  Bot-client import builder collapses an explicit null to undefined for every
  nullable field, so a re-import never clears
status: To Do
assignee: []
created_date: '2026-09-13 21:39'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 966000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/commands/character/import.ts builds the gateway payload with `field: data.field ?? undefined` for every nullable field, customFields included (grep -n "?? undefined" services/bot-client/src/commands/character/import.ts). The gateway now distinguishes the two (TASK-948, PR 2416: explicit null clears a Json? column to SQL NULL; absent leaves it), so an export file carrying null for a field re-imported into an EXISTING slug keeps the previous value instead of clearing it. Surfaced by the PR 2416 review round 5. Not a defect for a fresh import (nothing to clear) and applies uniformly to every nullable field in that builder, not customFields alone.
Owner question: on a re-import into an existing slug, should a null field in the export file clear the stored value, or leave it alone as today?
Recommendation: leave it alone — an import file is additive by intent, and clearing is what the dashboard and the update route are for; close this task on that ruling with a one-line comment at the builder saying null means skip on purpose.
Fix shape if the ruling is clear: forward null as null for the nullable fields (the gateway update schema already accepts null for customFields; check each other nullable field schema before forwarding) and pin one re-import case in the command test.
Acceptance: either the ruling is recorded at the builder as a comment and the task closes, or a re-import with a null field clears the stored value and a test pins it.
<!-- SECTION:DESCRIPTION:END -->
