---
id: TASK-517
title: Sync the 05-tooling commit-scope table with commitlint.config.cjs
status: To Do
assignee: []
created_date: '2026-08-11 00:53'
updated_date: '2026-09-04 19:42'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 517000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2059 review noticed .claude/rules/05-tooling.md lists six commit scopes (ai-worker, api-gateway, bot-client, common-types, ci, deps) while commitlint.config.cjs allows a larger static+dynamic list (skills, rules, docs, hooks, and more) — the table under-documents what the hook accepts, so agents avoid valid scopes or trip on the mismatch mentally.
What: regenerate the table from commitlint.config.cjs (or replace the enumeration with a pointer to the config as the source of truth plus the few most-used scopes). Rules edits are review-gated — ride the next .claude/rules PR.
Acceptance: the rules table and the config cannot disagree (pointer form), or the table matches the config exactly with a note naming the config as canonical.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:42
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. shipped: 05-tooling.md carries the pointer form the acceptance asked for (1b2344c3c).
---
<!-- COMMENTS:END -->
