---
id: TASK-140
title: 'extractRunnerDistCopies anchors to the LAST FROM stage, not AS runner by name'
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 140000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`extractRunnerDistCopies` anchors to the LAST `FROM` stage, not `AS runner` by name

**Why:** Correct for all current Dockerfiles (runner is always last). If a stage is ever added AFTER runner (debug stage, `FROM scratch AS export`), the guard would silently scan the wrong stage → false negatives. **Fix sketch** (from review): `RUNNER_STAGE_PATTERN = /^\s*FROM\s+\S+\s+AS\s+runner\b/i`, `findIndex` for it, fall back to last-FROM when absent (single-stage case). **Promote when**: any service Dockerfile gains a stage after runner, or the guard false-negatives on a real miss. Surfaced by PR #1148 post-autosquash claude-review. Deferred 2026-06-03.
<!-- SECTION:DESCRIPTION:END -->
