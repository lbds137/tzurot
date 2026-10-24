---
id: TASK-1233
title: Route claude-code-action dependabot bumps past the develop guard
status: To Do
assignee: []
created_date: '2026-10-16 04:11'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1221000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: filed by Deck 2026-10-15 (Lila merged #2621 via main-cut). The github-actions dependabot ecosystem targets develop, and guard:workflow-sync requires claude-code-review.yml + claude.yml to land via a main-cut branch - so every claude-code-action dependabot PR opened against develop gets closed by the guard. #2616 (1.0.244-1.0.248) was the observed casualty, superseded by #2621 (1.0.251 + Opus model pin).

Fix shape: split the dependabot config - either exclude claude-code-action from the develop-targeting github-actions ecosystem entry, or add a second ecosystem entry targeting main for claude-code-action only (dependabot.yml supports per-ecosystem target-branch). Then dependabot opens its bumps where the guard allows them.

Closes when the first main-targeted claude-code-action bump PR opens after the release cut that lands the config on main (checklist: backlog/now.md Deploy notes).
<!-- SECTION:DESCRIPTION:END -->
