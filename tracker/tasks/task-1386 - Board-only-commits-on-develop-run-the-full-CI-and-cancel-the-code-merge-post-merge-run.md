---
id: TASK-1386
title: >-
  Board-only commits on develop run the full CI and cancel the code merge
  post-merge run
status: To Do
assignee: []
created_date: '2026-11-10T14:23:00Z'
labels:
  - area:ci
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1369000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: ci.yml:4-7 triggers on every push with no path filter, and ci.yml:13-15 cancel-in-progress groups by branch. 9 of the last 22 CI runs were docs(backlog) pushes to develop, and all 5 cancelled runs were develop runs cancelled by the next push (e.g. the abfc84511 merge run cancelled by board commit 0e8e8b6a9), so a code merge loses its post-merge CI signal whenever a board commit follows within ~8 min.
What: have buildCommitMessage (packages/tooling/src/dev/tracker-commit.ts:142) append [skip ci], or add a paths-ignore for tracker/ backlog/ docs/ root md on develop pushes (decide in the PR; [skip ci] covers only tool-made commits). Update .claude/skills/tzurot-git-workflow/SKILL.md:55.
Saving: ~2,300 runner-s per board commit (Fable perf review 2026-11-10, item P1).
Risk: backlog:lint and lines:check no longer run in CI on board SHAs; pre-push docs-only path runs both (.husky/pre-push:88-99).
Acceptance: a board-only push to develop starts no CI run; a code push still does.
<!-- SECTION:DESCRIPTION:END -->
