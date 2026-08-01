---
id: TASK-387
title: >-
  Live reference path cannot subtract chat-log enrichment: it renders before
  injection
status: To Do
assignee: []
created_date: '2026-08-01 10:45'
labels:
  - 'size:M'
dependencies: []
priority: medium
ordinal: 387000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced by TASK-368's replay-path fix (#1887).**\n\nA deduped quote should not repeat media the chat-log entry already renders. #1887 derives that for the REPLAY path (`formatQuotedSection` holds the history entries). The LIVE path cannot answer the question at all, for an ordering reason:\n\n- Step 1 `ConversationalRAGService:324` `processInputs` -> `formatReferencedMessages` renders the live deduped stub.\n- Step 1.5 `ConversationalRAGService:354` `enrichRagHistory` -> `injectImageDescriptions` MUTATES `context.rawConversationHistory`, populating `imageDescriptions`.\n\nSo at render time the entries carry no descriptions yet; asking "does the chat log already carry this?" always answers no, and answers wrong for exactly the case worth subtracting. `enrichRawReferences` has `history` too but runs even earlier (context assembly), so it is no better.\n\nThis is the shared-mutable-context seam class (#1884 / rule 7 clause from #1886) in a THIRD place: two steps communicating through a field on a shared object, correctness decided by which runs first.\n\n**Fix shape (needs design):** either (a) move the reference render after Step 1.5 — but processInputs also produces things 1.5 does not depend on, so the reorder needs its own evidence; or (b) hoist "each description appears once in the prompt" to a prompt-assembly-level invariant instead of a per-renderer decision. (b) is the better framing and the bigger change.\n\n**Impact:** token redundancy only, one turn per live reply, not a correctness regression. Replay (the long tail) is fixed.\n\n**Acceptance:** a live deduped reference to a message whose history entry renders <image_descriptions> does not also render them in the quote; a sequencing test runs Step 1 and Step 1.5 in order (rule 7's shared-context clause).
## RUNTIME-CONFIRMED 2026-08-01 (req `1ab06c8d`)

Owner replied directly to an image and asked the character to confirm it was not
described twice. It was. The identical **1374-character** vision description
appears twice in one prompt: once in `<contextual_references>` (the live quote)
and once in `<chat_log>` (the referenced message's own entry).

Upgrades the impact line above from "token redundancy, one turn per live reply"
to a measured ~1.4KB per occurrence, on the most ordinary interaction there is —
replying to an image.

**Why it appeared only now:** #1884 restored extended-context descriptions.
Before that the chat-log entry carried none, so the live quote's copy was the
only one and there was nothing to duplicate. Fixing #1884 is what made this
visible — the duplication is older than the day it was noticed.

**Testing note:** a direct reply exercises the LIVE path and therefore does NOT
test #1887, which fixed replay only. Verifying #1887 needs a second turn so the
stored reference is re-rendered from inside `<chat_log>`. A smoke item asking
for a direct reply tests this task's gap, not #1887's fix.
<!-- SECTION:DESCRIPTION:END -->
