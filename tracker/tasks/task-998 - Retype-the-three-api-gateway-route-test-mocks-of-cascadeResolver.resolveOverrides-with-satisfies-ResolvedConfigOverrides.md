---
id: TASK-998
title: >-
  Retype the three api-gateway route test mocks of
  cascadeResolver.resolveOverrides with satisfies ResolvedConfigOverrides
status: To Do
assignee: []
created_date: '2026-09-16 23:46'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 994000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/api-gateway/src/routes/user/llm-config.test.ts, config-overrides.test.ts, and personality-config-overrides.test.ts hand-roll the resolver mock as an untyped object literal (vi.fn().mockResolvedValue({...})). They lack crossChannelRenderMode and crossChannelMaxMessages (PR #2442) and also shareHistoryAcrossPersonalities (the previous cascade field), so the compiler never sees the drift. Production is unaffected: the routes forward the resolver object whole. But a future change that hand-picks response fields would not be caught by these tests. Cost hypothesized, not measured, hence low. Found by claude-review on PR #2442 round 3.
Fix shape: type each mock payload with satisfies ResolvedConfigOverrides (Core Principle 8), filling every field from HARDCODED_CONFIG_DEFAULTS where the test does not care; one PR, test files only.
Acceptance: the three fixtures fail typecheck:spec when a cascade field is added to ResolvedConfigOverrides and not to them.
<!-- SECTION:DESCRIPTION:END -->
