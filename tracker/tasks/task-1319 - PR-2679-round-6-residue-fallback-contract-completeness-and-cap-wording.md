---
id: TASK-1319
title: 'PR 2679 round-6 residue: fallback-contract completeness and cap wording'
status: Done
assignee: []
created_date: '2026-10-28T20:03:00Z'
updated_date: '2026-10-28T22:02:00Z'
labels:
  - area:skills
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1302000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Four open findings from PR 2679 round-6 claude-review (cap reached at 6 cycles; merge proceeds per the recorded 2678 precedent). All are prose-completeness items on text the PR introduces; none blocking, none behavioral.

1. The spec-template fallback-contract paragraph (under item 6) omits the deleted contract's central clauses: execute-exactly / STOP on material divergence (spec-vs-guard conflict, file not matching its description), regenerate generated artifacts only via sanctioned commands (the codegen:routes dist trap in 05-tooling.md makes this one load-bearing), and scratch containment. Add them to the clause list.
2. Give those clauses a named sub-heading (e.g. Fallback worker contract) instead of sitting under Stop conditions, and point the § Cloud dispatch paragraph at the NAME instead of spec-template item-6 — template renumbering has happened before and would silently break a numeric pointer.
3. Fold the lowercase parenthetical (still capped at five lines; only the no-subagent fallback lifts the cap) into its preceding sentence in § Dispatch lane, and fix the its/lane wrap artifact.
4. Spec-template item 7: add one clause noting cross-lane headless specs must inline the verification-floor commands explicitly (those workers may not load .claude/rules; no regression — the deleted file bound only Agent-tool workers either way).

Finding 4 of the round (TASK-1316 close-out note in the task file) is already satisfied on develop (b2f8060f1) — the reviewer sandbox read the PR head, which does not carry tracker files.
<!-- SECTION:DESCRIPTION:END -->
