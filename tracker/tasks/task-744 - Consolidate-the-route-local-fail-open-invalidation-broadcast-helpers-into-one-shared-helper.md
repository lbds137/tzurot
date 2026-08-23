---
id: TASK-744
title: >-
  Consolidate the route-local fail-open invalidation broadcast helpers into one
  shared helper
status: To Do
assignee: []
created_date: '2026-08-23 12:28'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 744000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2192 review (round 1, finding 3, not blocking). The fail-open broadcast shape - if service undefined return; try await publish; catch warn - now exists as 4 named per-file helper copies (user/persona/crud.ts + override.ts broadcastPersonaInvalidation; user/channel/activate.ts + deactivate.ts broadcastChannelActivationInvalidation) plus at least 4 older inline copies (user/persona/default.ts, user/{stt,tts,model}-override.ts). One generic helper (service, publish callback, warn logger) fits under the 2-callback ceiling per the reviewer sketch in the #2192 review.

Fix shape: add the generic helper in a shared api-gateway util with a colocated test (fail-open pinned both ways), convert all ~8 sites, grep-enumerate with a positive control before claiming the sweep complete.

Acceptance: one helper, all enumerated sites converted, no per-file broadcast helper copies remain in api-gateway routes; each converted route keeps its existing seam tests green.
<!-- SECTION:DESCRIPTION:END -->
