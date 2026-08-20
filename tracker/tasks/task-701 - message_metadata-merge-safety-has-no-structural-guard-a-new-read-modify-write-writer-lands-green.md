---
id: TASK-701
title: >-
  message_metadata merge-safety has no structural guard - a new
  read-modify-write writer lands green
status: To Do
assignee: []
created_date: '2026-08-20 16:17'
labels:
  - 'area:conversation-history'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 701000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 2026-08-20 pre-release second-look of #2145. The merge module docstring claims the service is structurally incapable of a read-modify-write writer, but ConversationHistoryClient exposes full conversationHistory.update() and ConversationHistoryUpdateInput accepts messageMetadata - adding the field to any existing update() payload compiles, passes lint, depcruise, and BOTH test tiers (the component seam test runs writers sequentially, so an RMW also passes it - Core Principle 9 unmet). Only one method-scoped unit assertion pins one method. Evidence: packages/conversation-history/src/messageMetadataMerge.ts:12-18 (claim), ConversationMessageMapper.ts:36 (client type), ConversationHistoryService.ts:265 (the RMW skeleton one field away).

Fix shape: a mechanical guard - a tooling check or lint rule rejecting messageMetadata inside any conversationHistory update/updateMany/upsert data payload outside the sanctioned merge module - plus correct the docstring to claim what is actually enforced. Optional hardening from the same review: guard the merge SQL against a jsonb null (jsonb_typeof check) since Prisma.JsonNull is one line from corrupting the column into an array, and hedge the "no other writer can hold a reference" claim (the row id is publicly re-derivable; safety rests on bot-client awaiting the persist).

Acceptance: adding messageMetadata to an update() payload outside the merge module fails a gate, pinned by the guard own test; the docstring claims match the enforcement.
<!-- SECTION:DESCRIPTION:END -->
