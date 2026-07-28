---
id: TASK-174
title: Simplify the conversation persist handlers' stale dual-write fallback + doc
status: To Do
assignee: []
created_date: '2026-06-25 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'area:db'
  - 'size:M'
dependencies: []
priority: low
ordinal: 174000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Simplify the conversation persist handlers' stale dual-write fallback + doc

**Why:** `conversationUserMessage.ts` + `conversationAssistantMessage.ts` carry a "dual-write window" JSDoc + a `compareExisting`-first + `P2002`-race fallback that assume a concurrent **legacy direct writer**. That writer is gone — the 2.5d epic closed dual-write and bot-client's `saveUserMessage` now routes through the gateway (no direct Prisma), so the gateway endpoint is the sole writer. The doc is misleading and the P2002-race branch is likely dead. **Fix shape**: grep-confirm no second `conversationHistory` writer remains, then drop/simplify the compare-first + P2002 fallback and rewrite the JSDoc to describe the single-writer reality. Behavioral change to the write path → its own PR, separate from the beta.138 timeout fix. **Promote when**: next touching the persist handlers, or a dual-write-doc-confusion report. Surfaced 2026-06-25 during the fast-pool-timeout investigation.
<!-- SECTION:DESCRIPTION:END -->
