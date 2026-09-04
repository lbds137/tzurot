---
id: TASK-65
title: Surgical eviction for HttpPersonalityLoader invalidation
status: To Do
assignee: []
created_date: '2026-06-04 00:00'
updated_date: '2026-09-04 20:03'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surgical eviction for `HttpPersonalityLoader` invalidation

**Why:** Personality pub/sub events carry an ID but the routing caches are `(userId, nameOrId)`-keyed, so any single invalidation does a full two-tier clear (500 + 2000 caps; rebuild = one round-trip per active probe). Fine at current scale. **Fix shape**: side-table mapping `personalityId → Set<cacheKey>` enabling targeted eviction. **Promote when**: personality edits become frequent enough that full clears across instances produce visible gateway-traffic spikes (watch the clear-applied debug log frequency vs `/internal/personality/load` volume). Surfaced by PR #1156 claude-review (both final reviewers independently). Deferred 2026-06-04.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:03
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-65 finds it.
---
<!-- COMMENTS:END -->
