---
id: TASK-220
title: Resolve-cascade route lacks the UUID gate its sibling mutators have
status: Done
assignee: []
created_date: '2026-07-06 00:00'
updated_date: '2026-07-28 18:13'
labels:
  - 'area:db'
  - 'origin:review'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 220000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Resolve-cascade route lacks the UUID gate its sibling mutators have

**Why:** `config-overrides.ts` `handleResolveCascade` reads `:personalityId` via bare `getRequiredParam` while the PATCH/DELETE handlers 400 on malformed ids via `getValidatedPersonalityId`; a malformed id on the GET path likely surfaces as a Prisma uuid-cast error (500-shaped) instead of a 400. One-line fix (call the shared helper) but it changes the route's error contract, so it wants its own tiny PR + a test rather than riding a behavior-preservation refactor. Surfaced 2026-07-06 (PR #1518 review adjacency flag).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped in #1834 (8f02ee6f7): handleResolveCascade now uses getValidatedPersonalityId like its siblings; malformed ids 400 instead of 500, resolver-never-called pinned by test.
<!-- SECTION:NOTES:END -->
