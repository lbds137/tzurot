---
id: TASK-420
title: Confirm whether diagnostic GETs intentionally skip requireProvisionedUser
status: Done
assignee: []
created_date: '2026-08-03 23:36'
updated_date: '2026-08-05 10:01'
labels:
  - 'size:S'
  - 'area:api-gateway'
dependencies: []
priority: low
ordinal: 420000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the four /api/user/diagnostic GETs carry requireUserAuth but not requireProvisionedUser, unique among user-audience routes (surfaced during TASK-412 mounts-test work). Handlers filter rows by userId server-side, so this may be intentional (identity suffices, no user row needed) - but auth-policy uniqueness deserves a deliberate yes/no from the owner rather than an agent assumption.
Fix shape: if intentional, add a one-line comment at the mount site saying so; if not, add the middleware and a mounts-level test.
Acceptance: the asymmetry is either documented as deliberate or eliminated.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
RESOLVED 2026-08-05 (owner deferred to agent judgment after close code review): intentional and already documented. The mount site (generated mounts.ts) comes from packages/clients/src/routes/user/diagnostics.ts, whose module docblock has said since 2026-05-25 — predating this task — that these routes deliberately skip requireProvisionedUser because the subject row may not be provisioned (owner inspects arbitrary subjects via ?userId=). Close review confirmed the design is sound: all four handlers use the fail-closed resolveCallerUserId guard, non-owner filtering is a server-side WHERE on the Discord snowflake, and no handler reads the internal UUIDs requireProvisionedUser attaches. Adding the middleware would be semantically wrong (provision-on-read side effect; breaks owner inspection of unprovisioned subjects). Acceptance met with zero code change.
<!-- SECTION:NOTES:END -->
