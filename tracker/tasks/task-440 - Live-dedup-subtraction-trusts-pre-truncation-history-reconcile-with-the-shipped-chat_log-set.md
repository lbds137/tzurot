---
id: TASK-440
title: >-
  Live dedup subtraction trusts pre-truncation history - reconcile with the
  shipped chat_log set
status: To Do
assignee: []
created_date: '2026-08-05 16:52'
updated_date: '2026-08-05 16:52'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 440000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #1978 (TASK-387) derives carriedByChatLog from context.rawConversationHistory at Step 1, but <chat_log> is finalized by budget selection at Step 2.5/4, which drops OLDEST entries when over budget. If the quoted entry (carrying imageDescriptions) is truncation-dropped AFTER the stub subtracted against it, the paid description reaches NEITHER the stub NOR the chat log - silent content loss, worse than the double-render #1978 fixed. Raised by the #1978 review (Medium); accept-and-track was the review-offered disposition because the in-PR fix is structurally blocked: the rendered reference block feeds budgetOptionsBase (ConversationalRAGService ~:396), so selection depends on reference size and a post-selection re-render reopens the budget - the exact circular shape the replay path avoids by building its index from selectedEntries.

Trigger conditions (all required): reply-to-message dedup + enriched description + the quoted entry old enough to be budget-dropped (long history x tight context window). The TEXT side of this family (stub pointing at a truncated-out entry) is PRE-existing and older than #1978; media newly joined it.

Fix shapes: (a) render full refs for budget estimation, project deduped stubs AFTER preselectHistory with the carried set reconciled against the shipped ids / oldestSelectedTs (conservative: estimation with full-size refs slightly under-allocates history); (b) fold into the doc-8 family fix (budget-adjacent code trusting PRE-truncation state for POST-truncation-dependent decisions - same class as the #1645 STM/LTM hole).

Acceptance: a deduped reference whose history entry is dropped by budget selection renders its description in the stub (subtraction cancelled); a sequencing/budget test pins it.
<!-- SECTION:DESCRIPTION:END -->
