---
id: TASK-211
title: 'Capture-race: a mid-flight memory can escape a delete-sync sweep'
status: To Do
assignee: []
created_date: '2026-07-05 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:conversation-history'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 211000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Capture-race window: a memory captured mid-flight after a delete-sync sweep escapes propagation

**Why:** Propagation fires once at soft-delete time; a memory whose generation completes AFTER that sweep carries the deleted trigger id but is never retroactively caught (RAG filter checks only memories.visibility, no join to conversation_history.deletedAt). Low probability (slow generation × sync pass in the window), non-catastrophic (one stale memory surfaces, no data loss). **Fix shape**: either a capture-time check (trigger row already deleted → capture as visibility='deleted') or a periodic reconciliation sweep. **Promote when**: memory Phase 2 extraction lands (same pipeline), or a stale-memory report. Surfaced by #1497 final review. Surfaced 2026-07-05 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
