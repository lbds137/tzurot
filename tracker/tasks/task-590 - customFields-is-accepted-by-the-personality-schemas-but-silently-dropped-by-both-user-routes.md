---
id: TASK-590
title: >-
  customFields is accepted by the personality schemas but silently dropped by
  both user routes
status: To Do
assignee: []
created_date: '2026-08-13 18:08'
updated_date: '2026-08-14 22:31'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 590000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: /character import sends customFields (PersonalityCreateSchema/PersonalityUpdateSchema both accept it) and /character export emits it, but neither USER route writes the column. create.ts buildCreateData builds an explicit Prisma object with no customFields key; update.ts buildUpdateData omits it from simpleFields and has no special case (contrast admin/updatePersonality.ts:66-67, which does forward it). Consequence: an export/re-import round-trip loses customFields entirely, with a success embed that lists "Custom Fields" as imported. The admin path works, so the data is reachable - just not by its owner.

Fix shape: decide whether users may write arbitrary JSONB at all (owner call - it is currently admin-only by construction, not by policy). If yes, forward customFields in both user routes the way admin/updatePersonality does, with a PGLite route test per path. If no, strip it from PersonalityCreateSchema/PersonalityUpdateSchema for the user surface and drop it from the export field list and the import field-def list, so nothing promises what nothing delivers.

Acceptance: either a user create+update round-trip persists customFields, or no user-facing surface mentions it.

Source: found while building TASK-565 (export clear-form fix); export.ts EXPORT_FIELDS carries a comment pointing here.

**DECIDED 2026-08-14 (owner, TASK-599 digest): FORWARD customFields in both user routes (mirror admin/updatePersonality) with a size bound; PGLite route test per path.**
<!-- SECTION:DESCRIPTION:END -->
