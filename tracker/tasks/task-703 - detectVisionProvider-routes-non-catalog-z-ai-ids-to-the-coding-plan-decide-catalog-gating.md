---
id: TASK-703
title: >-
  detectVisionProvider routes non-catalog z-ai ids to the coding plan - decide
  catalog-gating
status: To Do
assignee: []
created_date: '2026-08-20 16:17'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 703000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 2026-08-20 pre-release second-look of #2153. detectVisionProvider is shape-keyed: after the :free guard, any non-catalog z-ai/<model> (including retired z-ai/glm-4.5-air) still returns ZaiCoding - pinned by ProviderRouter.test.ts:507. No spend exposure (getSystemApiKey returns null for ZaiCoding, so a guest mis-route fail-fasts; a key-holder burns their own plan on a request z.ai reroutes to text-only glm-4.7). The #2153 removal rationale (catalog removal sends the id to OpenRouter) is true for the MAIN route, false for vision. Also: the functions JSDoc rule enumeration omits the :free rule that now runs first (ProviderRouter.ts:342-352) - fix the doc regardless.

Fix shape: decide deliberately whether the z-ai/ vision branch should gate on catalog membership (isZaiCodingPlanModel) like the main route; either way update the JSDoc enumeration and the recorded removal rationale.

Acceptance: the gating decision is recorded with its reason; the JSDoc matches the predicate order; a test pins whichever gating is chosen.
<!-- SECTION:DESCRIPTION:END -->
