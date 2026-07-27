---
id: TASK-221
title: "Episode type value rename 'memory'→'episode' + zod vocabulary"
status: To Do
assignee: []
created_date: '2026-07-06 00:00'
labels:
  - 'area:db'
dependencies: []
ordinal: 221000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Episode `type` value rename 'memory'→'episode' + zod vocabulary — `memories.type` still uses legacy values ('memory'/'knowledge') vs the artifact's typed model (episode/fact/reflection/canon); facts live in their own table so the rename is cosmetic. **Promote when**: any migration touches the memories table anyway. Filed 2026-07-06 (Phase 2 plan).

**Why:** Avoids a solo migration for naming.
<!-- SECTION:DESCRIPTION:END -->
