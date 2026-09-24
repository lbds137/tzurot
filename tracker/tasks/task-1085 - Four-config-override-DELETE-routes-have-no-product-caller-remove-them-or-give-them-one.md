---
id: TASK-1085
title: >-
  Four config-override DELETE routes have no product caller: remove them or give
  them one
status: To Do
assignee: []
created_date: '2026-09-24 18:23'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1078000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2509 (doc-72 PR B) retired the channel dashboard DELETE-based reset for a batch-null PATCH, and its claude-review flagged the channel DELETE route as orphaned. A sweep on the PR head (git grep of the four client method names over services/*/src and packages/*/src, non-test, non-generated; positive control: clearChannelConfigOverrides matches its manifest entry) shows ALL FOUR config-override clear routes have no product caller. Their only references are the route manifest (packages/clients/src/routes), the codegen handler-path map (packages/tooling/src/codegen/handler-paths.ts) and a conformance fixture: clearChannelConfigOverrides (DELETE /api/user/channel/:channelId/config-overrides), clearUserDefaults (DELETE .../config-overrides/defaults), clearPersonalityOverrides (DELETE .../config-overrides/:personalityId), clearAdminSettings (DELETE /api/admin/settings/config-defaults). Dead API surface bit-rots unobserved, and each DELETE clears keys no dashboard shows, unlike the new Reset all.
Fix shape: remove all four (gateway handler + route registration, manifest entry, codegen path, conformance fixture, their tests, regenerated client) in one PR, re-running pnpm ops codegen:routes --check and the conformance suite; or, if a caller is planned, name it here and keep the route with a test that exercises it.
Acceptance: git grep for the four method names returns nothing outside git history, or each survivor has a named product caller; pnpm quality and the gateway conformance tests pass.
<!-- SECTION:DESCRIPTION:END -->
