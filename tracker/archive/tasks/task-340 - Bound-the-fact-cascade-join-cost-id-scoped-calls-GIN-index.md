---
id: TASK-340
title: Bound the fact-cascade join cost (id-scoped calls + GIN index)
status: To Do
assignee: []
created_date: '2026-07-28 13:05'
updated_date: '2026-09-04 20:01'
labels:
  - 'area:db'
  - 'size:M'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 340000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: propagateDeletionToFacts (packages/conversation-history/src/memoryDeletionPropagation.ts) joins ALL visibility=deleted memories against all normal facts, inline in the request path of every /memory delete, batch delete, purge, and history-purge propagation. Deleted memories are never hard-purged, so the join's left side grows monotonically — per-request cost creeps upward with corpus age rather than staying bounded by what the call changed. Chosen deliberately for self-healing + zero id-plumbing at current scale (documented in the docstring); this item is the escalation.\n\nFix shape: GIN index on memory_facts.source_memory_ids (lands WITH its query per 03-database) + switch call sites to id-scoped cascades (pass the just-deleted memory ids; keep the global-join form for a periodic or migration-time self-heal only).\n\nSurfaced by the #1826 review (non-blocking): "worth a tracker item now so it's not rediscovered cold when someone's purge request gets slow." Promote when: fact-table volume makes deletes measurably slow (p95 on delete routes) or memory_facts crosses ~100k rows.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:01
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-3 (Theme Database Performance Audit); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-340 finds it.
---
<!-- COMMENTS:END -->
