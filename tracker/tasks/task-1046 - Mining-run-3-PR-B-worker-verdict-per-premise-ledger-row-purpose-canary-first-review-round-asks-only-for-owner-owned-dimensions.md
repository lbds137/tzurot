---
id: TASK-1046
title: >-
  Mining run 3 PR B: worker verdict per premise-ledger row + purpose canary
  first; review-round asks only for owner-owned dimensions
status: To Do
assignee: []
created_date: '2026-09-22 18:21'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1040000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: session-mining run 3 (2026-09-22): in every mined corpus the orchestrator own dispatch spec was the dominant defect origin (2-3 wrong premises per unit) and the WORKER was what caught them, incidentally; the ledger gate enforces that a ledger exists, nothing enforces that anyone answers it. Separately, 21 of 23 review-round rulings in the window were taken as the Recommended option and both exceptions carried a non-engineering dimension. Owner adopted R1 and R5 on 2026-09-22.
Fix shape: (R1) .claude/skills/tzurot-orchestration/SKILL.md § The spec template item 9 (Report requirements): the worker report carries one line per Premise ledger row - verified (with the command whose output is the evidence), falsified (with what is true instead), or not reachable from this worktree; item 7: a spec canary set opens with the unit PURPOSE stated as its own sentence, canaried first by name, with that canary failure COUNT read as a coverage measurement. Closes TASK-1029. (R5) .claude/skills/tzurot-review-response/SKILL.md § 1 and § 4: classification gets a second axis beside edit shape - a semantic finding whose options differ only on engineering grounds is decided by the agent and reported under Auto-applied tagged [semantic:decided] with the reasoning and the option not taken; Asks is reserved for findings with a product/UX, schema, user-visible, spend, or data-rights dimension; the four-section report still always appears so the owner can reverse any decided item.
Timing: land BEFORE the next drain window opens so the ledger instrument is constant across the effort-sweep boundary.
Acceptance: both skill sections carry the text; TASK-1029 closed by the PR; lines:check within budget.
<!-- SECTION:DESCRIPTION:END -->
