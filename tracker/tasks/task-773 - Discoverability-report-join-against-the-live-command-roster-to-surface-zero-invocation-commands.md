---
id: TASK-773
title: >-
  Discoverability report: join against the live command roster to surface
  zero-invocation commands
status: To Do
assignee: []
created_date: '2026-08-25 19:54'
updated_date: '2026-08-25 19:55'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 773000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: telemetry:report (doc-12 P1.1) reads only command_events, so a command with ZERO invocations in the window has no rows and is structurally invisible — yet zero-use commands are the darkest features, the exact thing a discoverability report exists to find. v1 states this limitation in its own output (Limitations section).
Fix shape: derive a machine-readable roster of registered command dot-paths (command.subcommand, matching buildCommandPath in services/bot-client/src/handlers/commandDispatch.ts ~91-97) and left-join it into the report. Candidate sources: a small bot-client script exporting the defineCommand builders to JSON at build time (deployCommands.ts already walks them — services/bot-client/src/utils/deployCommands.ts), or the component-test snapshot as a kept-fresh artifact. Direct tooling->bot-client import was ruled out for v1: drags discord.js into the tooling package.
Acceptance: the report gains a "never invoked" section listing roster commands absent from the window, and the Limitations paragraph shrinks accordingly.
<!-- SECTION:DESCRIPTION:END -->
