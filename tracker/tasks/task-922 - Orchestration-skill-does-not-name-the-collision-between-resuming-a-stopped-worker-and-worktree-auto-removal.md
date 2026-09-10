---
id: TASK-922
title: >-
  Orchestration skill does not name the collision between resuming a stopped
  worker and worktree auto-removal
status: Done
assignee: []
created_date: '2026-09-09 15:58'
updated_date: '2026-09-10 01:18'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 920000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two instructions in .claude/skills/tzurot-orchestration/SKILL.md are each correct and collide silently. Section "When the worker reports" says a flagged stop is a good outcome and to resume the SAME worker by SendMessage rather than spawning fresh. Section "The base IS stale by default" separately records that the harness AUTO-REMOVES a worktree whose worker stops having changed nothing. A worker that stops on a premise-ledger row has by definition changed nothing, so its worktree is already gone and the resume lands in the SHARED checkout on the current branch, which is the exact state the isolation mandate exists to prevent.

Observed 2026-09-09 during TASK-920: a worker stopped correctly on a ledger row, the resume was issued per the resume-the-same-worker guidance, and the post-resume check showed only the main tree in git worktree list. The agent was killed before it wrote anything and the main tree was verified untouched by git status --porcelain, so nothing was lost, but the only thing that caught it was running the isolation re-verify promptly. Section "Resuming a worktree-isolated worker" already tells you to run that check, and correctly warns it RACES the worker rather than preceding it, which is precisely why the check is the wrong place to catch this case: the collision is predictable BEFORE the send.

Fix shape: one sentence in "Resuming a worktree-isolated worker" saying that a worker which stopped having changed nothing has no worktree to resume into, so git worktree list is checked BEFORE the SendMessage rather than after, and a missing tree means re-dispatch fresh rather than resume. The distinguishing signal is available at zero cost, since the workers own report says whether it made edits. Consider also a cross-reference from "When the worker reports" where the resume-the-same-worker preference is stated, because that is the sentence being read at the moment of the mistake.

Note the second-order cost this avoids: a fresh re-dispatch re-pays the whole spec, so the resume preference is real and should be kept. The edit narrows it rather than reversing it.

Acceptance: the skill states the precondition at the resume instruction; a reader following only "When the worker reports" is pointed at it before sending; landed via PR since .claude/skills is review-gated.
<!-- SECTION:DESCRIPTION:END -->

Narrowed by the beta.221 pre-release audit (2026-09-09): two of the three sentences this task asks for already exist on develop. The base-is-stale section already says the harness auto-removes a worktree whose worker stops having changed nothing and that a resume then lands in the shared tree (grep: changed nothing), and When the worker reports already carries the cross-reference (grep: A resume is not isolation-preserving). What remains is only the pre-send precondition in Resuming a worktree-isolated worker: it still instructs the git worktree list check AFTER the SendMessage and never says that a worker whose own report says it made no edits is checked BEFORE the send and re-dispatched fresh when the tree is gone. Size stays S; it is one sentence in one section, landed via PR.
