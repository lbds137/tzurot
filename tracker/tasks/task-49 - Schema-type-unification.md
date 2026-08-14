---
id: TASK-49
title: Schema-type unification
status: To Do
assignee: []
created_date: '2026-06-26 00:00'
updated_date: '2026-08-14 01:04'
labels:
  - 'area:common-types'
  - 'area:tooling'
  - 'area:jobs'
  - 'size:L'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Schema-type unification — derive job-payload types from their Zod schemas (`z.infer<>`)

**Why:** Residual from the now-complete "Tooling & Quality Ratchet" theme (all 4 CI ratchets shipped; this last sub-item didn't). Several BullMQ job payloads still declare a hand-written `interface` alongside the Zod schema (`ShapesImportJobData`, `AudioTranscriptionJobData`, etc.) — the two can drift. **Fix shape**: replace the hand-written interfaces with `type X = z.infer<typeof xSchema>` so the schema is the single source of truth. **Promote when**: next touching `common-types/types/*-job*` / queue types, or opportunistically. Surfaced 2026-06-26 (queue reconciliation — demoted from the closed tooling-ratchet theme).
<!-- SECTION:DESCRIPTION:END -->
