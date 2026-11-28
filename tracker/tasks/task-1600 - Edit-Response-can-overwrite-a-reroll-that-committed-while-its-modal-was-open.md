---
id: TASK-1600
title: Edit Response can overwrite a reroll that committed while its modal was open
status: To Do
assignee: []
created_date: '2026-11-28T21:00:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1590000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the release review for beta.253 (#2835) found a cross-PR seam. Edit Response PATCH (historyEdit.ts handleEditAssistantMessage) sends only content and discordMessageIds and does not check the reroll lock (acquireRerollGuard is used only by rerollMessage.ts and recovery). If a reroll commits while an Edit Response modal is open, submitting the modal finds the NEW row via the same message id (findEditableRow) and writes the stale text over the reroll on Discord, history and its fresh memory, with no warning.

What: carry the row id the modal was opened for in the PATCH and answer 409 when it no longer matches, or refuse Edit Response while reroll:lock:<rowId> is held.

Acceptance: a test where a reroll commits between modal open and submit gets a 409 or refusal and leaves the rerolled text intact; add an edit-after-reroll smoke item.
<!-- SECTION:DESCRIPTION:END -->
