---
id: TASK-238
title: 'release:* CLI-wiring layer is untested'
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-07-28 10:51'
labels:
  - 'area:tooling'
  - 'origin:review'
  - 'size:M'
dependencies: []
priority: low
ordinal: 238000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

release:* CLI-wiring layer is untested — `commands.test.ts` covers no `release:*` subcommand — including release:publish's new `--notes-file` required-guard (`commands/release.ts`). Core `publish.ts` logic is thoroughly unit-tested; the gap is the cac registration + dispatch + required-flag guard. Not island-testing just publish (the other release subcommands are equally untested) — establish the release-command wiring test pattern once, covering all of them. **Promote when**: a release-command wiring bug bites, or during a tooling-test pass. Surfaced 2026-07-08 (PR #1563 review).

**Why:** Coverage of the one new-logic bit (the guard) + the pre-existing release-wiring gap.
<!-- SECTION:DESCRIPTION:END -->
