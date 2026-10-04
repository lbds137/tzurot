---
id: TASK-1157
title: >-
  Correct the G13b fixed-server-side claim in foreignInteraction.ts and reject
  AVATAR_STORAGE_PATH=/
status: To Do
assignee: []
created_date: '2026-10-04 16:26'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1149000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: GLM-week audit F4 + F7. (1) services/bot-client/src/utils/foreignInteraction.ts header says the fork cross-application delivery bug has been fixed server-side; the fork confirmed 2026-10-04 that no fix exists (doc-109 2026-10-04 entry), so the guard is the only defense, not defense-in-depth. (2) packages/common-types/src/config/config.ts keeps a bare / AVATAR_STORAGE_PATH (a test blesses it), but services/api-gateway/src/utils/avatarPaths.ts checks startsWith(AVATAR_ROOT + "/") = "//", which no resolved path satisfies, so every avatar write/delete is rejected as outside root.
What: reword the comment to cite doc-109 and the unfixed status; make containment sep-aware via path.relative (or reject / in the schema) with a red-first test.
Acceptance: comment matches doc-109; a test proves root=/ either fails validation or resolves avatars correctly.
<!-- SECTION:DESCRIPTION:END -->
