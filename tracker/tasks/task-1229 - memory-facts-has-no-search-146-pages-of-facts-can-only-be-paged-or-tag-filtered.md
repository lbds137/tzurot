---
id: TASK-1229
title: >-
  /memory facts has no search: 146 pages of facts can only be paged or
  tag-filtered
status: To Do
assignee: []
created_date: '2026-10-13 01:48'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1218000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner 2026-10-12, trying to fix stale Emily facts from the TASK-1224 eval: "146 pages of facts with no way to search". /memory facts browse (factsBrowse.ts, FACTS_PER_PAGE = 10) sorts by valid_from desc and offers only prev/next and a tag option; the gateway list (api-gateway routes/user/memoryFacts.ts) filters only by entityTags. The stale facts sat on pages 102, 107, 122, 125 and 131. Correcting your own data is the user-side half of fact supersession (TASK-671), so this is the practical blocker for every correction the eval found. High: a user cannot exercise control over stored data about themselves.

What: (1) a query option on /memory facts (statement text match in the gateway, ILIKE or the fact embedding for semantic match; check what /memory search does for memories and reuse it); (2) a jump-to-page affordance (doc-72 owns dashboard index navigation; reuse it if it shipped); (3) optionally a "contradicts" view: facts on the same entity tag sorted together, so conflicting facts (vapes vs switched to edibles) sit side by side.

Acceptance: /memory facts <character> query:monster returns the Monster facts on one page; a test pins the gateway filter.
<!-- SECTION:DESCRIPTION:END -->
