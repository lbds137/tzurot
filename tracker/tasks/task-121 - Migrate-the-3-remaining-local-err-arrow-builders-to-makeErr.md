---
id: TASK-121
title: Migrate the 3 remaining local err() arrow-builders to makeErr
status: To Do
assignee: []
created_date: '2026-07-02 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:bot-client'
  - 'area:testing'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 121000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Migrate the 3 remaining local `err()` arrow-builders to `makeErr`

**Why:** The 7 command-test `function err(status, message)` builders were swept to the shared `makeErr` (identical semantics). Three files remain with a DIFFERENT shape (`error: 'boom'`, status-only params, one without `kind`): `services/HttpPersonalityLoader.test.ts`, `utils/gatewayWriteHelpers.test.ts`, `utils/gatewayServiceCalls.test.ts` — call sites must become `makeErr(status, 'boom')` and assertions re-checked. **Promote when**: next touching any of those three test files. Surfaced 2026-06-xx; re-scoped 2026-07-02 (sweep).
<!-- SECTION:DESCRIPTION:END -->
