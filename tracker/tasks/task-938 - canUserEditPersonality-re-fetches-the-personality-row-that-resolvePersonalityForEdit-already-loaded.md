---
id: TASK-938
title: >-
  canUserEditPersonality re-fetches the personality row that
  resolvePersonalityForEdit already loaded
status: To Do
assignee: []
created_date: '2026-09-12 05:32'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 936000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: every personality edit route (update, delete, aliases, visibility, default-config) runs two personality.findUnique calls per request: resolvePersonalityForEdit fetches by slug, then canUserEditPersonality fetches the same row by id (services/api-gateway/src/routes/user/personality/helpers.ts, grep findUnique). Surfaced by review on PR 2398; no measured cost, one extra indexed lookup per edit request.
Fix shape: let canUserEditPersonality accept the already-loaded row (or its ownerId) as an optional argument so resolvePersonalityForEdit passes what it fetched; keep the by-id path for callers that only hold an id. Sweep every caller of canUserEditPersonality, keep the helpers test suite green, and add a test asserting a single findUnique per edit request.
Acceptance: one personality.findUnique per edit-route request in the helpers test; no caller behaviour change.
<!-- SECTION:DESCRIPTION:END -->
