---
id: TASK-520
title: Extend the external-system-claim trigger to code comments
status: To Do
assignee: []
created_date: '2026-08-11 02:45'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 520000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 00-critical section External-system claims already carries the constraint AND a decision-point trigger, and it was violated twice in one session anyway (PR 2060: a cac repeated-flag claim that a probe showed returns an array, not the last value; PR 2061: a claim that a timeout implies the request was delivered, when AbortSignal.timeout is created at the fetch call and so covers DNS and connect). Both were reviewer catches. The gap is not the constraint but the trigger framing: it targets STATING a claim, which reads as prose or a PR body, so writing a JSDoc that explains why code is shaped a certain way never registers as the moment.

What: extend the trigger in 00-critical (or the sibling clause in 02-code-standards section A Comment That Asserts Behavior Is a Claim, which currently scopes to runtime behavior of OUR code) to name the code-comment case explicitly: a comment whose explanatory clause describes what a dependency does is the same claim and needs the same probe-or-hedge. Keep it to a sentence — the rules corpus is budget-gated. Consider whether claim-shape-guard.sh can cheaply catch the narrow shape of a dependency name followed by a behavioral verb, or whether that is too noisy to be worth it.

Acceptance: the code-comment moment is named in a review-gated surface, so the next contributor meets the trigger where the failure actually happens.
<!-- SECTION:DESCRIPTION:END -->
