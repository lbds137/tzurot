---
id: TASK-348
title: Gateway maintenance 503 JSON hardcodes the Tzurot brand
status: Done
assignee: []
created_date: '2026-07-29 00:59'
updated_date: '2026-08-06 08:58'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 348000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by the #1845 post-autosquash review — services/api-gateway/src/middleware/maintenance.ts:25 hardcodes "Tzurot is undergoing scheduled maintenance..." in the 503 body. bot-client intercepts the user-facing path (fixed in #1845), so this only misbrands direct API callers / a future dashboard on dev. Fix shape: brand-neutral wording ("The service is undergoing scheduled maintenance..."), matching the gateway clean-JSON convention. Ride along with the next api-gateway-touching PR.
<!-- SECTION:DESCRIPTION:END -->
