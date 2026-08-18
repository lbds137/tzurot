---
id: TASK-654
title: 'guard:workflow-sync self-skips on any branch cut before a release'
status: To Do
assignee: []
created_date: '2026-08-18 10:25'
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
<!-- SECTION:DESCRIPTION:END -->
