---
id: TASK-1280
title: 'Facts batch: Cancel is silent when the browse session expired'
status: To Do
assignee: []
created_date: '2026-10-24 21:52'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1268000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2652 round-7 finding: refreshFactsList returns without replying when buildRefreshedFactsView is null, so a Cancel tap on the batch multi-select or confirm view does nothing visible and the message stays in batch mode. back already behaves this way; the batch buttons add two more paths through it. Fix: send the FACTS_SESSION_EXPIRED followUp in the null case (covers all three buttons). Size S, facts-family, one file.

PR 2653 round-3 scope addition: the null case covers BOTH a gone session AND a live session whose refresh fetch failed — the fix should send the expiry copy for the former and the transient copy (PAGE_FETCH_FAILED_COPY) for the latter, matching the memory flow's batch-cancel shape (interactionHandlers.ts batch-cancel branch, landed in #2653).

Shared-flow hardening siblings (drift-proof labels, second-tap guard, maxValues clamp, warning-first clamp, 6000 JSDoc, transient-copy const, confirm-refusal copy unification) are riders on the TASK-1253 spec, not this task.

PR 2654 round-1 addition (alias sibling, same class): the alias batch confirm (aliasBatch.ts) strips components, then a failed post-strip fetchAliasRows leaves a button-less confirm embed stranded with only a transient followUp — same shape as this task's facts fix. When this task's fix lands, sweep the alias flow (and confirm the memory flow) for the same post-strip-fetch-failure case; the fix there may want the result-only deliverBatchReport shape or a re-render, not just the expiry copy.
<!-- SECTION:DESCRIPTION:END -->
