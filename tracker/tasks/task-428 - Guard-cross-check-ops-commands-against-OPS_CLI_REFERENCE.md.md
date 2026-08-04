---
id: TASK-428
title: 'Guard: cross-check ops commands against OPS_CLI_REFERENCE.md'
status: Done
assignee: []
created_date: '2026-08-04 13:22'
updated_date: '2026-08-04 22:49'
labels:
  - 'size:S'
  - 'area:tooling'
dependencies: []
priority: medium
ordinal: 428000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: nothing programmatically verifies docs/reference/tooling/OPS_CLI_REFERENCE.md against the registered pnpm ops command set — the guard:commands-doc gate covers docs/commands.md (Discord slash commands) only. Surfaced twice in one PR (#1950): the Cache Commands section was missing entirely for four shipped commands, and both the implementing agent and the reviewer independently flagged that new ops commands can drift out of the doc silently.

Fix shape: a guard (audit-class criteria probably not met — binary sync check, like guard:duplicate-exports) that enumerates registered CLI commands from the cac registrations and fails when a command has no row in OPS_CLI_REFERENCE.md. Loose matching by command name is enough; per-option coverage is out of scope.

Acceptance: adding a new ops command without a doc row fails the gate.
<!-- SECTION:DESCRIPTION:END -->
