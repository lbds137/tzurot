---
id: TASK-911
title: 'release:range should note the gh pr diff 20k-line cap on large release PRs'
status: To Do
assignee: []
created_date: '2026-09-07 22:05'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 909000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on the beta.219 release PR (206 files) gh pr diff, including --name-only, returned 406 because the GitHub diff-rendering endpoint stops at 20,000 lines, and gh pr view --json files caps at 100 entries. The holistic reviewer recovered the file list locally with git diff --name-only origin/main HEAD. The release:range file-count line already warns at the 300-file render limit but says nothing about the line cap, so the next large release trips the same surprise.
Fix shape: have release:range print the diff line count next to the file count and flag ~20,000 lines as the gh pr diff cap, and add a one-line fallback note in the /tzurot-git-workflow release section (git diff --name-only origin/main origin/develop when gh pr diff 406s). packages/tooling/src/release/ holds the range command.
Acceptance: release:range prints a line count and a cap warning when it exceeds 20,000; the skill names the local fallback.
<!-- SECTION:DESCRIPTION:END -->
