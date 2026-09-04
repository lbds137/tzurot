---
id: TASK-228
title: 'guard:prompt-tags STRING_LITERALS regex mis-bounds nested template literals'
status: To Do
assignee: []
created_date: '2026-07-07 00:00'
updated_date: '2026-09-04 19:57'
labels:
  - 'origin:review'
  - 'area:tooling'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 228000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

guard:prompt-tags STRING_LITERALS regex mis-bounds nested template literals — A template literal containing a nested backtick template inside `${...}` terminates the outer match at the first inner backtick — could misparse rather than fail loudly if a formatter is refactored to nested templates (none exist today; TAG_PROPERTY/HELPER_TAG_ARG would likely still catch the tag). **Fix shape**: brace-aware template scan, or accept the redundancy. **Promote when**: a formatter introduces nested templates. Surfaced 2026-07-07 (#1538 post-autosquash review).

**Why:** Guard parses every emission shape robustly.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:57
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-74 (Idea Guard workspace root coverage — three guards hardcode two of four roots); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-228 finds it.
---
<!-- COMMENTS:END -->
