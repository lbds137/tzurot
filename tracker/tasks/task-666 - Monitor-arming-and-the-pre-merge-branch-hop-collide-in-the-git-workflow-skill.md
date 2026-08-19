---
id: TASK-666
title: Monitor arming and the pre-merge branch hop collide in the git-workflow skill
status: To Do
assignee: []
created_date: '2026-08-19 00:24'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 666000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: hit on PR #2145 (2026-08-18). Two sections of /tzurot-git-workflow each give correct advice, and following both in the wrong order breaks the gate.

Section A (PR Monitoring) says arm the monitor immediately after every push, with the SHA as a literal $(git rev-parse HEAD) substitution, and warns that anything moving HEAD before the monitor EXECUTES makes it watch a different SHA -- naming a branch hop as the likelier trigger.

Section B (Before merging) says the head branch must be checked out nowhere, so get the main checkout onto develop before gh pr merge.

Neither says WHEN to do B relative to A. Doing B early -- while a monitor is still armed -- means the substitution resolves to develop HEAD at execution time and the gate silently watches the wrong commit. On #2145 this surfaced loudly only because the agent noticed and hand-pasted an abbreviated SHA instead, which the gate rejected outright (exit 1). The silent variant is the dangerous one.

Fix shape: state the ordering explicitly in the skill -- arm from the branch, wait for CI_COMPLETE, THEN checkout develop, then merge. One sentence in the Before-merging section, cross-referencing the monitor section.

Skills are review-gated, so this needs a PR rather than a direct develop commit.
<!-- SECTION:DESCRIPTION:END -->
