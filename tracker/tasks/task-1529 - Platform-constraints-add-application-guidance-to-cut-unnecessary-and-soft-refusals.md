---
id: TASK-1529
title: >-
  Platform constraints: add application guidance to cut unnecessary and soft
  refusals
status: To Do
assignee: []
created_date: '2026-11-24T13:18:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:dependent
dependencies: []
priority: medium
ordinal: 1526000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PLATFORM_CONSTRAINTS (services/ai-worker/src/services/prompt/HardcodedConstraints.ts, grep PLATFORM_CONSTRAINTS) lists four prohibitions (minors, CBRN, malware, doxxing/targeted harassment) but says nothing about how to apply them: no line saying everything outside the list gets a full answer, that charged words are story parameters rather than refusal triggers, or that a decline should name the constraint it rests on. A grep of the prompt-assembly code for refus/disclaimer/lectur/gatekeep found nothing (positive control: PromptLogger.ts matched); preset and character prompts in the DB were not checked. Anthropic models soft-refuse established intimacy (the reason character play routes to GLM), which is the failure this guidance targets.

Prompted by a community prompt (Lila 11-24) that pairs a near-identical prohibition list with application rules. Not lifted verbatim: its single-adult-user / private-partner framing does not fit multi-user Discord channels. Aim is balance: fewer unnecessary and soft refusals while the four hard lines hold.

What: draft application guidance for the platform block (scope-the-list, charged-words-are-parameters, name-the-constraint-on-decline, no disclaimers or lectures), worded for shared channels. Measure before shipping: run it as an extra arm in the TASK-1400 Claude character eval (same packet, with and without), and check GLM is not degraded. PLATFORM_CONSTRAINTS is the S0 cacheable prefix, so a change invalidates the shared cache once.

Acceptance: an eval result showing refusal and soft-refusal rate with vs without the guidance on at least the Claude and GLM arms, no hard-line regressions in a probe set aimed at the four constraints, and the adopted wording shipped (or a recorded ruled-out reason).

Related: TASK-1400 (eval host), TASK-1261 (censoring providers), TASK-1033 (vision NSFW refusals), doc-85 (prompt-effectiveness audit).
<!-- SECTION:DESCRIPTION:END -->
