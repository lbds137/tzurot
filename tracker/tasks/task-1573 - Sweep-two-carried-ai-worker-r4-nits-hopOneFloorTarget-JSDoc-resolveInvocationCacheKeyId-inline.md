---
id: TASK-1573
title: >-
  Sweep two carried ai-worker r4 nits (hopOneFloorTarget JSDoc +
  resolveInvocationCacheKeyId inline)
status: To Do
assignee: []
created_date: '2026-11-27T19:16:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1563000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: carried from PR 2827 r4 as mechanical nits riding PR 2, but the PR 2 worker spec dropped them (driver error, stated in the PR 2 body). What: (1) rewrite the stale guest-semantics JSDoc on selectHopOneFloorTarget and the hopOneFloorTarget header comment - the guest routing prose predates the tier-seam change; (2) inline resolveInvocationCacheKeyId at its call site - single-use wrapper. Acceptance: JSDoc describes current provenance-based routing; wrapper gone or justified; ai-worker gates green.
<!-- SECTION:DESCRIPTION:END -->
