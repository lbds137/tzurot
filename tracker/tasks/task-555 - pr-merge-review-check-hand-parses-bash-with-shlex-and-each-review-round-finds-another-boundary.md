---
id: TASK-555
title: >-
  pr-merge-review-check hand-parses bash with shlex, and each review round finds
  another boundary
status: To Do
assignee: []
created_date: '2026-08-12 17:23'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 555000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2078 rounds 5-8 were the same defect class four times. shlex tokenizes; it does not model bash grammar. Every round found one more place where "which tokens belong to this invocation" was wrong:

- round 5: a redirection OPERATOR read as a command separator, truncating the flag walk (under-arm)
- round 6: a bare NEWLINE not read as a separator at all, walking into the next statement (false block, and a wrong-PR misattribution)
- round 7: a backslash CONTINUATION read as a statement break, so a decoy inside an echo armed the gate (false block, unrecoverable)
- round 8: a redirection TARGET scanned as an argument, so a file named -d read as the flag (false block)

Each fix is correct and pinned. The pattern is what matters: the fixes are patches to a model that is approximately-bash rather than bash, so the supply of boundary cases is not obviously exhausted. Every one of them was found by review rather than by the 221-assertion probe suite, because the fixtures shared the blind spot with the code.

Two directions, not exclusive:

(a) Reduce exposure rather than chase completeness. Every one of these findings was "false block with no escape", and that severity comes entirely from the delete-branch guard being deliberately NOT ackable. Making it ackable after one showing turns any future tokenizer gap from unrecoverable into one retry. The cost is a precondition that can be bypassed by retrying, which is exactly what the not-ackable design was for - so this is an owner-facing tradeoff about how strict the gate should be, not an engineering call.

(b) Replace the hand-rolled walk with a real parser. bashlex is the obvious candidate but adds a dependency to a hook that currently needs only stdlib, and hooks run on EVERY Bash tool call, so import cost is a live concern. Would need measuring before it is a proposal.

Landmines: the PR-number walk and the flag walk have deliberately OPPOSITE strictness (the number must not over-collect, the flag must not under-collect), so any rewrite has to preserve both directions rather than unify them. The fallback paths (legacy_scan, adjacent_merge_scan, depth cap) deliberately over-arm the review gate and deliberately do NOT arm the guard - that asymmetry is load-bearing and is documented in the file.

Acceptance: either the exposure is reduced so a tokenizer gap is recoverable, or the parsing is replaced with something that models bash, or the class is ruled out on merit with the residual risk stated.
<!-- SECTION:DESCRIPTION:END -->
