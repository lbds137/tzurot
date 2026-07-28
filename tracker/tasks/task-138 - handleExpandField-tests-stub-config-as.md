---
id: TASK-138
title: 'handleExpandField tests stub config as {}'
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'area:testing'
  - 'size:S'
dependencies: []
priority: low
ordinal: 138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`handleExpandField` tests stub `config` as `{}`

**Why:** Fine today — the handler ignores its `_config` param. **Promote when**: `handleExpandField` starts reading config properties; the stubbed `{}` would silently skip coverage of those paths. Surfaced by PR #1149 claude-review. Deferred 2026-06-03.
<!-- SECTION:DESCRIPTION:END -->
