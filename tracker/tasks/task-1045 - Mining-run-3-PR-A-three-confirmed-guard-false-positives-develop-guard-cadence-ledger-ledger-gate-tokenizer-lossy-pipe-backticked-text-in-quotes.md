---
id: TASK-1045
title: >-
  Mining run 3 PR A: three confirmed guard false positives (develop-guard
  cadence-ledger, ledger-gate tokenizer, lossy-pipe backticked text in quotes)
status: To Do
assignee: []
created_date: '2026-09-22 18:21'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1039000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: session-mining run 3 (2026-09-22) reproduced three guard false positives against the live hooks with discriminating fixtures, the first non-trivial FP count in four runs. Owner adopted R2+R3+R4 on 2026-09-22.
Fix shape, in this order inside one PR: (R2) .claude/hooks/develop-code-commit-guard.sh drops backlog/cadence-ledger.json from its gated set (the only JSON under backlog/, and 00-critical.md § Direct doc commits names it as needing no PR); probe case asserting exit 0 for a cadence-ledger-only dirty tree on develop. (R3) .claude/hooks/dispatch-spec-ledger-gate.sh widens the trailing-punctuation strip on a pnpm script token from backtick . , ) to also cover : * ] } and both quote characters, so a closing backtick followed by a colon or a bold marker is not glued onto the script name; probe cases for both reproduced shapes plus the existing undeclared-script true-positive arm. (R4, LAST, highest blast radius) .claude/hooks/lib/shell_quotes.py skips a backtick or $( ) substitution span whose opening character lies inside a single-quoted region (bash never executes it), so a backticked git command mentioned inside quoted content being written no longer trips lossy-pipe-guard; probe cases in BOTH lossy-pipe-guard.probe.sh and develop-code-commit-guard.probe.sh since both blocking guards consume the helper; the documented double-quoted bypass stays blocked. PRECONDITION for R4: an adversarial break-it pass from a fresh context before the PR opens; if it is not run, split R4 out and ship R2+R3 alone.
Acceptance: pnpm ops guard:hook-probes green with the new cases; each of the three reproduced fixtures passes the guard it tripped; the true-positive arms still block.
<!-- SECTION:DESCRIPTION:END -->
