---
id: TASK-420
title: Confirm whether diagnostic GETs intentionally skip requireProvisionedUser
status: To Do
assignee: []
created_date: '2026-08-03 23:36'
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
