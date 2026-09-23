---
id: TASK-1060
title: Route codegen types enum-backed query options as plain string
status: To Do
assignee: []
created_date: '2026-09-23 20:41'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1054000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the route codegen (packages/tooling/src/codegen, method-builder) emits `string` for a query option whose manifest schema is a z.enum, so packages/clients/src/clients/_generated/user-client.ts types e.g. getDefaultModelConfig(options: { slot?: string }) and getUserUsage(options: { period?: string }) instead of ModelSlot / UsagePeriod. A caller can pass an invalid value that only fails at the gateway 400. 8 `slot?: string` sites in user-client.ts at filing (git grep -n "slot?: string"). Surfaced by claude-review on PR #2491.
Fix shape: have method-builder map a z.enum query field to its literal union (or import the named type) when rendering options; regenerate all three clients and fix any caller that passed a wider string.
Acceptance: generated clients type enum-backed query options as their literal union; a method-builder test pins it (method-builder.test.ts already has z.enum fixtures at lines ~279 and ~352).
<!-- SECTION:DESCRIPTION:END -->
