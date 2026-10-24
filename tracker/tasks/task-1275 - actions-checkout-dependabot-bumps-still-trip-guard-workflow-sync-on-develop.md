---
id: TASK-1275
title: 'actions/checkout dependabot bumps still trip guard:workflow-sync on develop'
status: To Do
assignee: []
created_date: '2026-10-24 08:22'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
type: bug
ordinal: 1263000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
claude-code-review.yml:32 and claude.yml:29 pin actions/checkout@v7 (ci.yml too), so a develop-based checkout bump edits the guarded files and fails the guard exactly like the claude-code-action bumps TASK-1233 routed around. Dependabot cannot partition one action by file, so checkout stays on the develop github-actions entry; the workaround on each occurrence is the manual cherry-pick path already documented in tzurot-git-workflow (the dependabot paragraph: cherry-pick the claude-workflow hunks into a fresh main-cut PR, merge that first, let the ci.yml hunk ride develop). Promote when: the next actions/checkout bump PR opens red on guard:workflow-sync - then either run the cherry-pick dance or, if it recurs, consider ignore plus deliberate manual majors.
<!-- SECTION:DESCRIPTION:END -->
