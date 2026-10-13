---
id: TASK-1229
title: >-
  /memory facts: contradicts view (facts on the same entity tag side by side);
  text search shipped
status: To Do
assignee: []
created_date: '2026-10-13 01:48'
updated_date: '2026-10-13 03:41'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1218000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner 2026-10-12, trying to fix stale Emily facts from the TASK-1224 eval: "146 pages of facts with no way to search". /memory facts browse (factsBrowse.ts, FACTS_PER_PAGE = 10) sorts by valid_from desc and offers only prev/next and a tag option; the gateway list (api-gateway routes/user/memoryFacts.ts) filters only by entityTags. The stale facts sat on pages 102, 107, 122, 125 and 131. Correcting your own data is the user-side half of fact supersession (TASK-671), so this is the practical blocker for every correction the eval found. High: a user cannot exercise control over stored data about themselves.

What: (1) a query option on /memory facts (statement text match in the gateway, ILIKE or the fact embedding for semantic match; check what /memory search does for memories and reuse it); (2) a jump-to-page affordance (doc-72 owns dashboard index navigation; reuse it if it shipped); (3) optionally a "contradicts" view: facts on the same entity tag sorted together, so conflicting facts (vapes vs switched to edibles) sit side by side.

Acceptance: /memory facts <character> query:monster returns the Monster facts on one page; a test pins the gateway filter.

Split 2026-10-12 (driver): this PR ships (1) only, as a case-insensitive statement text match carried exactly like the tag filter (route contract, gateway where-clause, session data, embed filter line). Grounding: the tag filter already rides the Redis session, not the customId (factsBrowse.ts FactsSession), so the query needs no customId budget. (2) jump-to-page did not ship anywhere (git grep jump/goto page over services and packages: no hits) and doc-72 owns generic dashboard index navigation; with search in place, the 146-page case no longer depends on it, so it stays with doc-72. (3) contradicts view stays open here as the remaining item after the search PR merges. Semantic (embedding) match is not in this PR: text match meets the acceptance; revisit only if text match misses real lookups.

SHIPPED (1) 2026-10-12: PR 2615 merged to develop (ada587304 + 2cdcff53a); reaches users with the next release (beta.237). The acceptance is met. Remaining on this task: (3) the contradicts view only, now medium priority (search already lets a user find both sides of a contradiction by keyword). Built on the agy tier (Gemini 3.8 Flash): two worker rounds plus driver gates; the worker wrongly skipped the PGLite component test as needing containers, and missed the command-options snapshot, which CI caught.
<!-- SECTION:DESCRIPTION:END -->
