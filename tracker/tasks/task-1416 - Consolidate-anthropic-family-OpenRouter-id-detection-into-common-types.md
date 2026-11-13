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

WIDENED by PR 2748 round-1 review (nothing blocking, dispositioned to here): (a) the predicate is now duplicated BYTE-FOR-BYTE between bot-client embed.ts and extendedViews.ts (both keyed on modelUsed post-2748) - the sibling copies share a directory and can import freely, so an inspect-local shared module (e.g. inspect/cacheFamily.ts + colocated test) is the in-service half; decide at execution whether the common-types home covers both halves or the inspect module is interim. (b) the docblock justification says "cross-service imports are forbidden" - true but not the reason for the sibling copy; state the real one. (c) the view predicate mirrors only the FAMILY conjunct of the worker gate - the gate also requires modelConfig.promptCaching === true; either document /inspect's (non)reachability for non-conversation calls or carry an injected-cache_control flag in diagnostics (cleaner). (d) small test nits riding the same files: the 620 Cache Write test back to family-agnostic or renamed; predicate-edge table (modelUsed absent + 0 -> omitted, mixed-case Anthropic/ -> matched); optional toLocaleString alignment on the summary embed's Cache Write/Cached Tokens lines.
<!-- SECTION:DESCRIPTION:END -->
