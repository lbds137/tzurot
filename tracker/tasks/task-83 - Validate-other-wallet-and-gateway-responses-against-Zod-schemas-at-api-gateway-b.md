---
id: TASK-83
title: >-
  Validate other /wallet/* and gateway responses against Zod schemas at
  api-gateway boundary
status: To Do
assignee: []
created_date: '2026-04-26 00:00'
updated_date: '2026-07-28 10:47'
labels:
  - 'area:api-gateway'
  - 'area:common-types'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Validate other `/wallet/*` and gateway responses against Zod schemas at api-gateway boundary

**Why:** `/wallet/list` resolved in batch-1 cleanup PR (parses through `ListWalletKeysResponseSchema` before `sendCustomSuccess`). Same gap on other gateway endpoints with hand-coded response shapes against schemas in `common-types/schemas/api/`: `/wallet/test`, `/wallet/:provider` DELETE, admin/_ and user/_ sub-routes. **Fix shape**: same pattern — `Schema.parse(payload)` before send. Or invest in wrapping `sendCustomSuccess` with a schema-aware variant so the parse happens centrally. Folds naturally into the Observability & Telemetry theme. **Heads-up on the error path** (PR #929 round 1): `asyncHandler` catches thrown errors and includes `error.message` in the 500 response body. `ZodError.message` includes the full field path and expected/received shapes — fine for authenticated internal endpoints, but if extended to public-facing endpoints, the leak surface needs separate treatment (catch `ZodError` specifically, return generic 500). **Promote when**: extending response validation to additional `/wallet/*` or admin/user routes, OR alongside the Observability & Telemetry theme. Surfaced 2026-04-26 PR #908. Deferred 2026-05-01.
<!-- SECTION:DESCRIPTION:END -->
