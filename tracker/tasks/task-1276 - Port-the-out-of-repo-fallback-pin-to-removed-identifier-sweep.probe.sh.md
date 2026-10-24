---
id: TASK-1276
title: Port the out-of-repo fallback pin to removed-identifier-sweep.probe.sh
status: To Do
assignee: []
created_date: '2026-10-24 09:11'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
type: chore
ordinal: 1264000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2647 round-3 review: claim-shape-guard.probe.sh now pins the CLAUDE_PROJECT_DIR fallback arm (cwd outside any repo, GIT_CEILING_DIRECTORIES for hermeticity), but the sibling hook removed-identifier-sweep.sh has the same arm and its probe never takes it either. Port the same one-case pin (stage a fixture in the throwaway repo, run the hook from an out-of-repo dir with the env var set, assert the banner) or decide the arm is dead and remove it from both hooks in one PR.
<!-- SECTION:DESCRIPTION:END -->
