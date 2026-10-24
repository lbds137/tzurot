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

Shared-flow hardening siblings (drift-proof labels, second-tap guard, maxValues clamp, warning-first clamp, 6000 JSDoc, transient-copy const) are riders on the TASK-1253 spec, not this task.
<!-- SECTION:DESCRIPTION:END -->
