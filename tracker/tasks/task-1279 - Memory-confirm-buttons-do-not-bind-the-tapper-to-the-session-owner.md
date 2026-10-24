---
id: TASK-1279
title: Memory confirm buttons do not bind the tapper to the session owner
status: To Do
assignee: []
created_date: '2026-10-24 18:01'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1267000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Code-reading finding from the TASK-1252 diff (2026-10-24): handleBatchConfirm and the pre-existing single-fact confirm-forget accept the tap of any channel member who can see the message - neither rebinds interaction.user to the dashboard session owner, and whether the gateway fact routes scope by the calling user is unverified. If gateway-side scoping exists (provisioned-user middleware), a foreign tap 404s harmlessly; if not, a stranger can forget or lock facts of another user. Blast radius grew with the batch (N per tap vs 1).

Acceptance: verify gateway-side scoping per fact route (quote the middleware or handler line that proves it); if scoped, record the evidence here and close as covered; if unscoped, add a tapper==session-owner guard in the memory confirm handlers with a test.

Sibling: TASK-352 (channel settings dashboards, no live permission recheck) - same class, different surface.
<!-- SECTION:DESCRIPTION:END -->
