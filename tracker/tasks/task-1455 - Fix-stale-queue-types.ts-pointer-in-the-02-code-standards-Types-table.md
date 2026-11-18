---
id: TASK-1455
title: Fix stale queue-types.ts pointer in the 02-code-standards Types table
status: To Do
assignee: []
created_date: '2026-11-18T20:01:00Z'
labels:
  - area:docs
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1455000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Types and Constants table in .claude/rules/02-code-standards.md points BullMQ job payloads at types/queue-types.ts; the real table is packages/common-types/src/types/jobs.ts (skippedMessageSchema and JobContext.skippedMessages land there in the doc-66 unit). One-line pointer fix plus a grep sweep for other queue-types mentions across .claude/rules and docs. Rules files are load-bearing and review-gated: land via PR, never a direct develop commit. Acceptance: grep for queue-types across rules and docs returns no stale pointer.
<!-- SECTION:DESCRIPTION:END -->
