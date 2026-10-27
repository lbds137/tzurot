---
id: TASK-1280
title: 'Facts batch: Cancel is silent when the browse session expired'
status: Done
assignee: []
created_date: 2026-10-24 21:52
updated_date: '2026-10-27T14:52:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
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

PR 2661 round-1 addition (deny sibling, same class): the deny batch confirm (commands/deny/browseBatch.ts, handleDenyBatchConfirm) strips components, then a null pre-loop fetchEntries leaves the button-less confirm embed with only the transient followUp; claude-review suggested re-rendering the batch view or restoring Remove/Cancel on refusal. The same sweep covers it - five flows now share the shape (facts, memories, alias, override, deny), so the fix belongs in the shared confirm shape rather than per flow.

SHIPPED 2026-10-27, SPLIT (PR 2672). The facts half is Done: refreshFactsList answers a gone session with FACTS_SESSION_EXPIRED and a failed fetch with the transient notice, for Back, batch Cancel and the refresh after a forget, through one shared followUpFactsRefusal helper that logs and survives a rejected followUp; the post-forget wording is the owner-ruled TASK-1307. The SWEEP half (a refused batch confirm leaves the message button-less: facts, memories, alias, deny; override has no pre-loop fetch) was audited by code reading and moved to TASK-1306 (state:owner, with a recommendation) because strip-before-fetch is pinned by tests and the remedy is a UX decision.
<!-- SECTION:DESCRIPTION:END -->
