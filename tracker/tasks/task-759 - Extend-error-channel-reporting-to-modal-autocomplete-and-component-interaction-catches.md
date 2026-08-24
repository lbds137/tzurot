---
id: TASK-759
title: >-
  Extend error-channel reporting to modal, autocomplete, and
  component-interaction catches
status: To Do
assignee: []
created_date: '2026-08-24 03:44'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 759000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2206 review observation - CommandHandler handleModalInteraction, handleAutocomplete, and handleComponentInteraction each catch and log errors but never call reportError, matching the P0.1 telemetry scope (those paths were never instrumented). Buttons/selects are the highest-traffic interactive surface (dashboard/browse patterns), so system errors there are invisible to the owner channel.
Fix shape: one-line reportError call in each catch (source: command, classifyErrorCode), mirroring the dispatch catch wiring in commandDispatch.ts; consider whether those paths should also emit command_events rows (separate decision - the P0.1 emission was deliberately dispatch-only).
Acceptance: each catch reports with a test; deny/skip semantics unchanged.
<!-- SECTION:DESCRIPTION:END -->
