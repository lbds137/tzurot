---
id: TASK-138
title: 'handleExpandField tests stub config as {}'
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-09-04 19:56'
labels:
  - 'area:bot-client'
  - 'area:testing'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 138000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`handleExpandField` tests stub `config` as `{}`

**Why:** Fine today — the handler ignores its `_config` param. **Promote when**: `handleExpandField` starts reading config properties; the stubbed `{}` would silently skip coverage of those paths. Surfaced by PR #1149 claude-review. Deferred 2026-06-03.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:56
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-89 (Idea Silent degradation deferrals — the triggering change per member); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-138 finds it.
---
<!-- COMMENTS:END -->
