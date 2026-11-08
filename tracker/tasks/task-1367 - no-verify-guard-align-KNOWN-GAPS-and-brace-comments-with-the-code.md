---
id: TASK-1367
title: 'no-verify-guard: align KNOWN GAPS and brace comments with the code'
status: To Do
assignee: []
created_date: '2026-11-08T19:17:00Z'
labels:
  - area:hooks
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1350000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2724 review round 3 (claude-review 2026-11-08 14:11). Three comments in .claude/hooks/no-verify-guard.sh say something the code does not do, and 02-code-standards treats a behavior comment as a claim.

What: (1) generalize the KNOWN GAPS over-arm bullet: any unquoted separate-arg value whose leading letter run reaches n before an arg-taking letter blocks (git commit -m -no-op now blocks); add a probe row pinning that case. (2) BRACE_EXPANSION_RE comment: no whitespace or separator before its closing brace. (3) header: what gets blanked is any separator-free brace word, literal {x} included, not only {a,b} expansions.

Acceptance: the three comment edits, the new probe row, and the probe passing.
<!-- SECTION:DESCRIPTION:END -->
