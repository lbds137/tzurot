---
id: TASK-1416
title: Consolidate anthropic-family OpenRouter id detection into common-types
status: To Do
assignee: []
created_date: '2026-11-13T01:48:00Z'
labels:
  - area:common-types
  - state:ready
  - size:S
dependencies: []
priority: low
ordinal: 1402000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2747 round-2 residue: two regex copies of the same concept now exist - ai-worker isAnthropicFamilyModelId (ModelFactory, gates cache injection) and bot-client isAnthropicFamilyResponse (extendedViews, gates the cache-write explanation view; routedModel ?? modelUsed). Same prefix test, two services, and CPD cannot see semantic drift between regex copies. The natural home is common-types utils/constants beside the z.ai sibling toZaiWireModelId; both services import it. Deliberately NOT done in round 2: a mid-round extraction grows the PR into a new package + rebuild + re-review for a nit-adjacent fix. Consolidate at the next touch of either file (or when a third family check appears).
<!-- SECTION:DESCRIPTION:END -->
