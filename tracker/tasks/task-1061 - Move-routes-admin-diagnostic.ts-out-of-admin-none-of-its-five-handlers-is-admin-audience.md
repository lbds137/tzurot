---
id: TASK-1061
title: >-
  Move routes/admin/diagnostic.ts out of admin/: none of its five handlers is
  admin-audience
status: To Do
assignee: []
created_date: '2026-09-23 20:55'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1055000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/api-gateway/src/routes/admin/diagnostic.ts holds five handlers and none is mounted under /api/admin. services/api-gateway/src/routes/_generated/mounts.ts mounts handleGetRecentDiagnostics, handleGetDiagnosticByMessage, handleGetDiagnosticByResponse and handleGetDiagnosticByRequestId at /api/user/diagnostic/... and handleUpdateDiagnosticResponseIds at /api/internal/diagnostic/:requestId/response-ids. The folder name misstates the audience, and wrapping the recent handler with userRoutes.getRecentDiagnostics (PR #2491) made the drift visible. Surfaced by claude-review on PR #2491.
Fix shape: move the four user handlers to routes/user/diagnostic.ts and the internal one to routes/internal/ (or keep one file under the audience that owns most of it and note the exception), move the colocated test with them, and update the handler-import paths the route codegen emits (check how codegen resolves handler modules before moving).
Acceptance: no handler under routes/admin/ is mounted under a non-admin audience (compare mounts.ts); pnpm ops codegen:routes --check is up to date.
<!-- SECTION:DESCRIPTION:END -->
