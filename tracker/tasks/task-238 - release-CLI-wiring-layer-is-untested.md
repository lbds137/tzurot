---
id: TASK-238
title: 'release:* CLI-wiring layer is untested'
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:tooling'
  - 'origin:review'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 238000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

release:* CLI-wiring layer is untested — `commands.test.ts` covers no `release:*` subcommand — including release:publish's new `--notes-file` required-guard (`commands/release.ts`). Core `publish.ts` logic is thoroughly unit-tested; the gap is the cac registration + dispatch + required-flag guard. Not island-testing just publish (the other release subcommands are equally untested) — establish the release-command wiring test pattern once, covering all of them. **Promote when**: a release-command wiring bug bites, or during a tooling-test pass. Surfaced 2026-07-08 (PR #1563 review).

**Why:** Coverage of the one new-logic bit (the guard) + the pre-existing release-wiring gap.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Confirmed gap still real — `commands.test.ts` has zero coverage of any `release:*` subcommand, including the `--notes-file` required-flag guard the task calls out. Evidence: `grep -n "release" packages/tooling/src/commands/commands.test.ts` → 0 matches.
---
<!-- COMMENTS:END -->
