---
id: TASK-836
title: Merge-gate claim prompt should name the branch hazard
status: To Do
assignee: []
created_date: '2026-08-31 01:00'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 836000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the claim-shape scan in .claude/hooks/pr-merge-review-check.sh tells you to "verify each line above against the code it describes — grep the assignment or call sites". That instruction fires at the one moment when the code being described is MOST likely to be on a branch you are not standing on: you are merging a PR, so the diff is on the feature branch, while the working tree can be on develop or another branch entirely.

Observed 2026-08-30, PR 2262: the gate flagged a comment in add.ts. I grepped it while checked out on develop and got develops OLD version of the file, which still said "four scope subcommands" — the exact claim the PR had changed. I noticed only because the text disagreed with what I had just written. Re-running against origin/feat/... verified it properly.

This is a COMPLIANCE finding, not a missing-rule one. The rule already exists: 10-working-posture § "Lossy steps are for known output shapes" item (d), shipped in PR 2261 the same day — a working-tree read answers for the current checkout only. It still recurred, four hours later, at a moment the rule does not name.

Fix shape: add one line to the gate output, beside the existing "grep the assignment or call sites" instruction — verify against the PR head ref (git show <ref>:<path>, git grep <pat> <ref>), not the working tree, because at merge time the two routinely differ. The hook already knows the PR number, so it can print the head ref concretely rather than abstractly.

Acceptance: the merge gate output names the branch hazard at the claim-verification instruction; the hook probe covers the new line.
<!-- SECTION:DESCRIPTION:END -->
