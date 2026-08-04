---
id: TASK-419
title: Sweep stale pre-cutover route paths out of api-gateway test describe labels
status: Done
assignee: []
created_date: '2026-08-03 23:11'
updated_date: '2026-08-04 07:28'
labels:
  - 'size:S'
  - 'area:api-gateway'
dependencies: []
priority: low
ordinal: 419000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 161 describe labels in routes/**/*.test.ts still name pre-cutover paths (describe POST /wallet/set etc.) vs 4 using the real mounted /api/... forms; TASK-412 fixed source docblocks but deliberately left test labels to keep the diff reviewable. Labels mislead when a failure is triaged from CI output.
Fix shape: one scripted pass mapping each label to the mounted path from routes/_generated/mounts.ts, same source of truth as the docblock sweep; presence-then-test after the bulk edit.
Also in scope (deferred from PR 1932, reviewer-endorsed): remove the now-inert vi.mock(AuthMiddleware) / vi.mock(ownerMiddleware) blocks in the retargeted user/channel and user/personality test files - after the asRouteHandler retarget the bare handlers never import that middleware, so the mocks intercept nothing; delete them plus any imports/fixtures that existed only for them.
Acceptance: grep for describe labels with non-/api paths returns only genuinely unmounted surfaces (public/protected routers); no vi.mock of AuthMiddleware/ownerMiddleware remains in a suite whose handlers do not import it.
<!-- SECTION:DESCRIPTION:END -->
