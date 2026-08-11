---
id: TASK-524
title: Resuming a worktree-isolated agent via SendMessage drops the isolation
status: To Do
assignee: []
created_date: '2026-08-11 14:04'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 524000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the orchestration skill mandates isolation: worktree for any file-mutating worker, AND separately prescribes resuming a stopped worker via SendMessage rather than respawning (the resume retains context and rides the prompt cache). Observed 2026-08-11 on the TASK-139/140 unit: the two instructions compose into the exact hazard the worktree mandate exists to prevent.

OBSERVED, not inferred. The worker spawned with isolation: worktree and reported a worktree base SHA of 8eb94ace6 (stale, 26 commits behind — `git rev-list --count 8eb94ace6..d961dfa6e`) — proving the worktree existed. It stopped on the base check. I resumed it with SendMessage; the tool result said "resumed from transcript in the background". On completion, git worktree list showed ONLY the main checkout, .claude/worktrees/ was empty, and the main checkout was sitting on the branch the worker created — so the resumed worker ran git checkout -b and all its edits in the ORCHESTRATOR tree.

No damage this time, purely by luck: the main tree happened to be clean at a just-pushed commit when the worker branched. Had the orchestrator been mid-edit, this is the documented 2026-08-09 collision class (a branch hop under a file-mutating worker), arriving through a door the mandate does not cover.

What: (1) After ANY SendMessage resume of a file-mutating worker, verify isolation still holds before trusting the worker to touch files - git worktree list, and confirm the orchestrator tree is not on the worker branch. (2) The orchestration skill needs this named next to its resume-rather-than-respawn guidance, which currently reads as unconditionally safe. That edit is .claude/skills, review-gated, so it rides a skills PR.

Acceptance: the skill states that a resumed worker may lose its worktree, and names the check; an orchestrator that resumes a worker verifies isolation before the worker edits anything.
<!-- SECTION:DESCRIPTION:END -->
