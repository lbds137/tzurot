---
id: TASK-506
title: gateway-client local env read misses the multi-slash strip
status: To Do
assignee: []
created_date: '2026-08-10 14:24'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 506000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: getServiceClientForEnv(local) in packages/tooling/src/utils/gateway-client.ts (~line 73) reads process.env.PUBLIC_GATEWAY_URL ?? GATEWAY_URL directly, bypassing the env-schema strip added in #2047. It is covered only by the transport layer single-slash strip (packages/clients transport.ts), so a local-dev value with 2+ trailing slashes still mints a doubled path for ops CLI calls. Flagged by the #2047 round-2 review; dev-tooling-only impact, never prod.
Fix shape: mirror the bounded strip at the read site (rawUrl?.replace with the {1,64} ceiling, matching deriveAvatarUrl) or route the local branch through getConfig(); one test either way.
Acceptance: a trailing-double-slash GATEWAY_URL in local env produces clean ops-CLI URLs; existing env selection behavior unchanged.
<!-- SECTION:DESCRIPTION:END -->
