---
id: TASK-279
title: Rename MemoryActionTokenService → ActionTokenService
status: To Do
assignee: []
created_date: '2026-07-15 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:api-gateway'
  - 'size:S'
dependencies: []
priority: low
ordinal: 279000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Rename `MemoryActionTokenService` → `ActionTokenService` — The service now mints memory-preview, memory-purge, AND account-deletion tokens — the `Memory` prefix undersells its scope and misleads greps. Pure rename (class, file, imports, tests). **Promote when**: next touch of that file. Surfaced 2026-07-15 (PR-B build).

**Why:** Names should match scope; three token families outgrew the original one.
<!-- SECTION:DESCRIPTION:END -->
