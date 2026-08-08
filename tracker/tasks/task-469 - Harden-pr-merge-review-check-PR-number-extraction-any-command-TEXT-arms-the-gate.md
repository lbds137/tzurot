---
id: TASK-469
title: >-
  Harden pr-merge-review-check PR-number extraction: any command TEXT arms the
  gate
status: To Do
assignee: []
created_date: '2026-08-08 15:49'
updated_date: '2026-08-08 15:50'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 469000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The PreToolUse hook matches the whole command TEXT, so the subcommand actually being invoked is irrelevant. Any Bash command whose text contains the phrase gh-pr-merge followed by a bare all-digit token arms the merge gate on that digit as a PR number.

Measured against the real hook (PATH-shimmed gh + id, PR read back from the fetched issues URL):

- gh pr comment N --body "... gh pr merge 1 in prose" -> fetches PR 1
- gh issue create --body "run gh pr merge 42 when ready" -> fetches PR 42
- echo gh pr merge 1 && gh pr merge 2002 -> fetches 1, not 2002
- quoted decoy (gh pr merge 1") -> correct; the closing quote makes the token non-bare

Observed in production twice: once on a read-only diagnostic that merely discussed merges, once on a reviewer submitting a claude-review body that quoted the hook internals. Both fetched an unrelated PR.

Why it matters: a wrong PR whose review is absent AND whose base is not main exits 0, and the merge proceeds UNREVIEWED. That is the exact outcome this hook exists to prevent. The two observed cases blocked only because the release reminder was independently due.

Fix shape: decide the PR number from the ARGUMENT VECTOR of an actual gh-pr-merge invocation rather than from a text scan of the whole command. At minimum, require that the matched occurrence is not inside a quoted string and that no earlier occurrence anchored the remainder. Semantic change to the highest-stakes hook, so it needs its own PR with the probe cases updated in the same change.

Acceptance: the three cases currently pinned as PINNED DEFECT in pr-merge-review-check.probe.sh flip to expecting the real PR number, and the probe stays green.
<!-- SECTION:DESCRIPTION:END -->
