---
id: TASK-572
title: >-
  snowflake raw-argv guard is file-granular and its UUID exemption is a text
  sniff
status: To Do
assignee: []
created_date: '2026-08-12 22:38'
updated_date: '2026-09-04 19:58'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 572000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: snowflakeFlagArgv.test.ts enforces source.includes(rawOptionValue(...)) per FILE - a file declaring the same id flag in two subcommands with only one raw read passes (collector dedups duplicate declarations); no current instance but the guard reports safety it does not fully check. The UUID exemption is /uuid/i over a 300-char description window: any description mentioning uuid exempts the flag even if it also accepts snowflakes.

Fix shape: per-declaration (command+flag) enforcement; exemption keyed on an explicit annotation instead of a text sniff.

Source: 2026-08-12 review, tooling L4 CONFIRMED latent.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:58
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: SUPERSEDED into doc-74 (Idea Guard workspace root coverage — three guards hardcode two of four roots); archived. The member bullet there carries the fix shape, trigger or cost, and the 2026-09-04 evidence; pnpm tracker doc search TASK-572 finds it.
---
<!-- COMMENTS:END -->
