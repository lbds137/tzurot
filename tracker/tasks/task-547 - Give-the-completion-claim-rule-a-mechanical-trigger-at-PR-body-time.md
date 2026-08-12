---
id: TASK-547
title: Give the completion-claim rule a mechanical trigger at PR-body time
status: Done
assignee: []
created_date: '2026-08-12 08:12'
updated_date: '2026-08-12 12:44'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 547000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 00-critical already carries "Completion claims require re-reading the scope definition". PR 2072 violated it anyway, and the reviewer cited that exact rule back. Over six review rounds on that one PR, four of the findings were not code defects at all — they were claims drifting from what was actually verified: a comment asserting "bound on every shell-out this module makes" sixty lines above an unbounded one; a module correctly analysed and then given no disposition; a sweep reported as exhaustive that had missed a gate-path site; and a PR body that said Closes TASK-N against an acceptance line it did not meet. The rule was known and still did not fire, because it targets a STATE (having a completion claim) rather than a MOMENT.

What: add a decision-point trigger to the PR-creation step of the git-workflow skill. Before writing any closing reference in a PR body, re-open the referenced task file, quote its acceptance line verbatim into the PR body, and state per clause whether it is met. If any clause is unmet the PR says partial and names the task carrying the remainder. Quoting the acceptance line is the mechanism — an overclaim survives paraphrase easily and rarely survives being placed next to the words it contradicts.

Also worth considering: the same PR showed that appending a correction under an overclaim leaves the wrong statement leading the document. A correction edits the original sentence; it does not annotate it. That belongs in review-response as a one-liner.

Rides the same skills PR as TASK-542 — both are .claude/skills edits and review-gated.

Acceptance: the git-workflow skill names the moment before a closing reference is written, and the check is quoting the acceptance line rather than recalling it.
<!-- SECTION:DESCRIPTION:END -->
