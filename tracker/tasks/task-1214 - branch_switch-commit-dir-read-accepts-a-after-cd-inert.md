---
id: TASK-1214
title: branch_switch commit-dir read accepts a ; after cd && <inert>
status: To Do
assignee: []
created_date: '2026-10-11 21:09'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1203000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: lib/branch_switch.py _commit_target reads `cd /other && git add a; git commit -m y` as commit dir /other with others-inert=1 (pinned as an Observed row in branch_switch_test.py, TASK-1211). The module docstring says EVERY join must be && because `a; b` runs b even when a failed. If the cd fails at run time after the hook resolved /other as a git toplevel (the dir vanishing between hook and run), the commit lands in the original checkout while develop-code-commit-guard judged /other. Narrow (a race; a nonexistent or unreadable dir does not resolve a toplevel, so it keeps the live evaluation per develop-code-commit-guard.probe.sh cross-repo comment), but it contradicts the docstring rule.

What: make the commit-dir read require && for every join, as the switch read does; update the Observed row in branch_switch_test.py to expect (None, None, False).

Acceptance: the row flips, and the canary of re-allowing ; reddens it.
<!-- SECTION:DESCRIPTION:END -->
