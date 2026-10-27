---
id: TASK-1306
title: >-
  Batch confirm refusals strand the message without buttons (facts, memories,
  alias, deny)
status: To Do
assignee: []
created_date: '2026-10-27T06:08:00Z'
labels:
  - area:bot-client
  - size:M
  - state:owner
dependencies: []
priority: medium
ordinal: 1291000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-1280 sweep (audited 2026-10-27, code-reading, not runtime-confirmed). In four of the five batch confirm handlers the component strip runs BEFORE the first fetch that can refuse, so a refused confirm (pre-loop page or list fetch fails, nothing mutated) leaves the confirm embed with no buttons and only an ephemeral notice: facts (factsBatch.ts, strip at the editReply components [] before resolveBatchLabels), memories (memoriesBatchConfirm.ts), alias (aliasBatchConfirm.ts, fetchAliasRows), deny (browseBatch.ts, fetchEntries null). The override confirm has no pre-loop fetch (labels come from the embed description), so it has no such path. Strip-before-fetch is deliberate and pinned by tests (titles like strips the confirm components BEFORE the first fetch, and the deny test asserts editReply is called once with components [] on a null fetch), so changing it changes existing assertions.

What: when a confirm refuses before mutating, put the user somewhere useful instead of a button-less embed: either re-render the confirm view with its original buttons restored, or re-render the browse list (Cancel shape). Shared flow, so one helper in utils/browse/multiSelectBatch.ts, then the four handlers.

Owner question: after a batch confirm refuses before mutating (the notice says the list could not be loaded), should the message come back with its Remove and Cancel buttons so you can retry, or stay button-less as today with the notice telling you to re-run the command?
Recommendation: restore the confirm view with its original buttons — nothing was mutated, a retry is one tap, and the strip-first order still guards the double-submit window because the buttons return only after the refusal is delivered.

Acceptance: per decision; every changed pinned assertion is called out in the PR body.
<!-- SECTION:DESCRIPTION:END -->
