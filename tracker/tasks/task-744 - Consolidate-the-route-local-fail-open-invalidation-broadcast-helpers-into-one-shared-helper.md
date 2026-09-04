---
id: TASK-744
title: >-
  Consolidate the route-local fail-open invalidation broadcast helpers into one
  shared helper
status: To Do
assignee: []
created_date: '2026-08-23 12:28'
updated_date: '2026-09-04 19:38'
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

Member additions from the #2192 review rounds: dbSync.ts carries two inline
copies of the shape (users + personas broadcasts) and default.ts carries two
more (user-channel + persona-channel blocks) — so the enumeration at build
time is ~10 sites across persona/{crud,override,default}.ts,
channel/{activate,deactivate}.ts, admin/dbSync.ts, and the older inline
stt/tts/model-override + AccountEraserService copies. Re-derive the count by
grep before claiming it.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `broadcastPersonaInvalidation`/`broadcastChannelActivationInvalidation` are still separately defined in `channel/activate.ts`, `channel/deactivate.ts`, `persona/crud.ts`, and `persona/override.ts` — no shared helper exists anywhere under `services/api-gateway/src/utils/`. Real, growing duplication (the task's own member-addition note puts the count at ~10 sites); a genuine DRY debt with the 2-callback-ceiling test already passed by the reviewer's sketch. Evidence: `git grep -ln "broadcastPersonaInvalidation\|broadcastChannelActivationInvalidation" services/api-gateway/src` → 4 per-file copies, no consolidated helper file found under `utils/`.
---
<!-- COMMENTS:END -->
