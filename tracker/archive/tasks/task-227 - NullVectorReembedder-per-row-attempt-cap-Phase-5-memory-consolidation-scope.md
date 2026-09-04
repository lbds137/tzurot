---
id: TASK-227
title: NullVectorReembedder per-row attempt cap (Phase-5 memory consolidation scope)
status: To Do
assignee: []
created_date: '2026-07-07 00:00'
updated_date: '2026-09-04 20:05'
labels:
  - 'area:ai-worker'
  - 'area:embeddings'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 227000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

NullVectorReembedder per-row attempt cap (Phase-5 memory consolidation scope) — A row whose re-embed persistently fails re-enters every hourly batch forever, occupying one of 50 slots. Failed counts ARE logged every run (visible signal), so severity is low; the sweep is deliberately minimal pending Phase-5 memory consolidation, which should absorb dead-letter semantics (attempt cap + sentinel) like PendingMemoryProcessor's. From the #1536 review. **Promote when**: Phase-5 scoping starts, or a persistent-failure row is observed in the sweep logs.

**Why:** Prevents a poisoned row from permanently occupying batch slots. Surfaced 2026-07-07 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 20:05
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-8 (Theme Memory System Overhaul — PARKED MID EPIC 2026 07 17); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-227 finds it.
---
<!-- COMMENTS:END -->
