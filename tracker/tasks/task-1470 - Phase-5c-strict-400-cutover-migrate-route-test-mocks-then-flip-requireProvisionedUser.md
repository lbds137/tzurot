---
id: TASK-1470
title: >-
  Phase 5c strict-400 cutover: migrate route-test mocks, then flip
  requireProvisionedUser
status: To Do
assignee: []
created_date: '2026-11-20T00:11:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:dependent
dependencies: []
priority: medium
ordinal: 1470000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the shadow-mode window (PR B to PR C per 01-architecture.md Request Enrichment) is still open; the middleware tightens once bot-client is fully rolled out. The migration plan lived only in a BACKLOG.md pointer and was untracked when that manifest retired (found by claude-review on PR 2772).
What: migrate the ~35 route test files whose createMockReqRes mocks requireProvisionedUser as a no-op over to createProvisionedMockReqRes (reference migration site: services/api-gateway/src/routes/user/shapes/auth.test.ts, tagged in its TODO comment), then flip the middleware to strict 400.
Acceptance: every createMockReqRes caller migrated before the flip; the strict-400 flip lands only after the bot-client rollout completes.
Promote when: bot-client fully rolled out on provisioned headers.
<!-- SECTION:DESCRIPTION:END -->
