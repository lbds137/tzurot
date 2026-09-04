---
id: TASK-141
title: check-deferred-refs PATH_TOKEN_PATTERN can over-match
status: To Do
assignee: []
created_date: '2026-06-03 00:00'
updated_date: '2026-09-04 19:57'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 141000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`PATH_TOKEN_PATTERN` in `packages/tooling/src/dev/check-deferred-refs.ts` can over-match inside URLs

**Why:** A GitHub deep link containing `/packages/...` or `/services/...` path segments in a deferred entry would be extracted as if it were a repo path, producing false-positive reminders. No current entry contains such links (entries reference paths bare). **Fix sketch**: exclude matches preceded by `://`-bearing prefixes (lookbehind or pre-strip URLs from the row before tokenizing). **Promote when**: deferred.md gains GitHub deep links to monorepo files, or a false-positive reminder is observed. Surfaced by PR #1151 claude-review. Deferred 2026-06-03.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:57
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-74 (Idea Guard workspace root coverage — three guards hardcode two of four roots); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-141 finds it.
---
<!-- COMMENTS:END -->
