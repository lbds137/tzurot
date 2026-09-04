---
id: TASK-184
title: 'take: 100 silently truncates the all-kinds list for power users'
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
updated_date: '2026-09-04 20:02'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 184000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`take: 100` silently truncates the all-kinds list for power users

**Why:** `handleListModelOverrides` (`model-override.ts`) and `LlmConfigService.list('all')` cap each query at `take: 100`. With `kind=all` a personality with both FKs expands to two summary rows (≤200), and USER-scope list runs two parallel capped queries (≤200) — neither returns a `hasMore` signal, so a user with 100+ override'd personalities (or 100+ configs) gets a silently-incomplete list with no way to tell "got everything" from "got the first 100". Power-user-only today; browse paginates so the in-view set is fine. **Fix shape**: cursor/offset pagination on the endpoint, or at minimum a `hasMore: boolean` in the response. **Promote when**: a user's personality/config count approaches ~100, or the list endpoints are reworked. Surfaced 2026-06-29 by PR #1383 (S2f) claude-review (non-blocking, documented in-code).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:02
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-92 (Idea Scale gated watches — threshold inventory for the single instance ceiling); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-184 finds it.
---
<!-- COMMENTS:END -->
