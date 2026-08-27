---
id: TASK-779
title: >-
  command-types codegen skips subcommand groups, so grouped commands silently
  get no typed option schemas
status: To Do
assignee: []
created_date: '2026-08-27 00:26'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 779000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/codegen/command-types.ts walks only FLAT subcommands when generating packages/common-types/src/generated/commandOptions.ts. Moving /deny to subcommand groups in PR 2233 removed denyAddOptions and denyRemoveOptions from the generated file with no grouped equivalent taking their place — 24 deleted lines, 0 added.

This is NOT a regression introduced by that PR. Verified: grep -cE "^export const (Preset|Memory|Settings|Admin)" over the generated file returns 0, so every command already using addSubcommandGroup (preset, memory, settings, admin) has likewise never had generated schemas. The deny schemas also had no consumers, so nothing broke.

The defect is that the gap is SILENT and grows. A command author who moves to groups loses typed option schemas without any signal: no error, no warning, and the generated file simply gets smaller. codegen:command-types --check passes because the committed file matches what the generator produces — the generator and the check agree with each other while both ignore half the command surface.

Fix shape, two parts and the second matters more:
(a) Teach the generator to walk subcommand groups and emit schemas for grouped subcommands. Naming needs a decision, since a flat denyAddOptions becomes something like denyAddChannelOptions per group+subcommand pair.
(b) Independently of (a), make the omission LOUD. Even if grouped support is deferred, the generator should report the commands it skipped rather than silently emitting nothing for them, so the next person to move a command to groups finds out at codegen time instead of never.

Do (b) even if (a) is declined — a known limitation that announces itself is a very different thing from one that does not.

Acceptance: either grouped subcommands produce typed schemas, or the generator names every command it skipped and why, and a command moving to groups cannot lose its schemas without someone being told.
<!-- SECTION:DESCRIPTION:END -->
