---
id: TASK-823
title: >-
  Late-result recovery confirms delivery on three paths that lose a real
  successful reply
status: To Do
assignee: []
created_date: '2026-08-29 18:32'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 823000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found while building TASK-821 (PR 2253), which split confirm-delivery so a DROPPED result is no longer recorded as delivered. That fix deliberately scoped itself to the unknown-job path. This task is the residue the audit surfaced and did not take.

Inside MessageHandler.tryRecoverLateResult, the finalize() helper confirms delivery unconditionally. On the happy path that is correct — the user already received the synthetic timeout message, so the confirm is not recording a loss as a success. But three sub-cases reach finalize() having lost a genuinely successful late reply: (a) the personality is no longer loadable, (b) the channel is gone, (c) the follow-up send threw. In each, a real generated reply exists and nobody receives it, yet the row flips to DELIVERED and nothing revisits a PENDING_DELIVERY row.

This is the SAME class as TASK-821 part B, one layer down. It was deferred there deliberately, on the reasons the rules require rather than convenience: a different mechanism from the unknown-job path, no runtime evidence that any of the three has actually fired in prod, and widening a high-priority prod fix to chase an unobserved case is the wrong trade. Recorded here so the deferral is a disposition rather than a silent omission.

Fix shape: NEEDS GROUNDING — re-read tryRecoverLateResult against the shipped 2253 diff before designing, because that diff moved the surrounding code and the sub-case boundaries may have shifted. Likely shape is to thread the same JobResultDisposition distinction into finalize() so only paths that actually delivered confirm, mirroring what 2253 did at the caller. Note the cost side: an unconfirmed row is never reclaimed, since the ai-worker cleanup deletes only DELIVERED rows — so honesty here trades a small permanent row leak for a visible loss signal, and that trade should be made deliberately.

Acceptance: a late-result recovery that fails to put anything in front of the user leaves the job unconfirmed (or raises a visible failure), while every path that did deliver still confirms; the row-reclamation consequence is decided explicitly rather than inherited.

Provenance: agent-generated follow-up from the TASK-821 build, named in the PR 2253 body — counts against the drain net.
<!-- SECTION:DESCRIPTION:END -->
