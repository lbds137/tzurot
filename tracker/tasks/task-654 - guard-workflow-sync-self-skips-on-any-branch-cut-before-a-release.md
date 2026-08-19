---
id: TASK-654
title: 'guard:workflow-sync self-skips on any branch cut before a release'
status: Done
assignee: []
created_date: '2026-08-18 10:25'
updated_date: '2026-08-19 02:08'
labels:
  - 'area:ci'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 654000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the topology test in isMainCutBranch (packages/tooling/src/dev/check-workflow-sync.ts) mistakes stale develop-cut branches for main-cut ones, so the guard skips exactly the PRs most likely to carry workflow drift.

Verified empirically on PR 2125 (dependabot, claude-code-action bump touching both guarded files): git merge-base FETCH_HEAD origin/develop returns ef2562de8, which IS origin/main HEAD, so merge-base --is-ancestor <mb> origin/main succeeds and the guard prints "main-cut branch — skipping". The PR own lint job was green and that green was NOT evidence of safety.

Root cause: release:finalize SHA-aligns develop onto main at each release. Any branch cut from develop BEFORE that release then has its merge-base with the rewritten develop land exactly at the release point, which is on main. The file doc comment anticipates only a narrow version of this ("when develop == main exactly"); the real window is every pre-release branch after every release. Dependabot PRs are long-lived and rarely rebased, so they are the common case — and the git-workflow skill names dependabot as this class most frequent trigger.

NOTE this CORRECTS the hypothesis recorded in TASK-646, which guessed a shallow-checkout fail-open via the catch path. That is not what happens; the guard takes the deliberate skip branch and reports success.

Fix shape, two candidates. (a) Give the guard the PR real base ref instead of inferring intent from topology: GITHUB_BASE_REF is only populated on pull_request events and this repo CI is push-only, which is why the reliable signal is unavailable — adding a pull_request trigger for the lint job would populate it. (b) Query the base via gh when running in CI. Prefer whichever avoids inferring author intent from git shape at all; the topology test is a proxy for a fact that GitHub already knows.

Acceptance: a develop-cut branch that predates a release and drifts a guarded workflow file FAILS the guard. Positive-control it by reproducing the 2125 shape — cut a branch from a pre-release develop commit, edit claude.yml, confirm red.

## THE DOCSTRING'S CLAIMED BACKSTOP HAS A HOLE IN THE SAME WINDOW (2026-08-18, measured)

check-workflow-sync.ts's header claims a mitigation: "(When develop == main
exactly, every branch looks main-cut and the guard skips -- a narrow false-pass
window; the push-to-develop CI run re-checks after merge.)" Two corrections.

FIRST, the trigger is not "develop == main exactly". Measured on this checkout:

  origin/main HEAD:              1856fa5bef42fd611676c6c92e6857ad51b09812
  merge-base(develop, main):     1856fa5bef42fd611676c6c92e6857ad51b09812

Because release:finalize SHA-aligns develop onto main, main's HEAD SITS ON
develop's history. isMainCutBranch asks whether merge-base(HEAD, origin/develop)
is an ancestor of origin/main -- and every develop commit at or before main HEAD
is one. So the skip fires for EVERY branch cut from develop before the last
release, not only when the two branches are identical. Dependabot PRs are
long-lived and rarely rebased, which is why they are the common case.

SECOND, the post-merge backstop is real but fails in the same window. On
develop, merge-base(develop, develop) is develop's own HEAD, which is not an
ancestor of main while develop is ahead -- so the guard runs and would catch the
drift. But immediately after release:finalize, develop IS main, so the
post-merge check skips too. The pre-merge misclassification and its stated
backstop have overlapping blind spots rather than complementary ones.

CONSEQUENCE FOR THE FIX CHOICE: this settles the open (a)-vs-(b) question in
favour of asking GitHub for the real base. The topology test is not merely
imprecise -- a genuine main-cut branch and a stale develop-cut branch are
LITERALLY THE SAME GIT SHAPE once main HEAD is on develop's history, so no
refinement of the topology can separate them. The information is not in the
graph. Candidate (b) also keeps the change inside packages/tooling, where (a)
would need a pull_request trigger added to a workflow file -- and a workflow
file edit is exactly the change class this guard governs.
<!-- SECTION:DESCRIPTION:END -->
