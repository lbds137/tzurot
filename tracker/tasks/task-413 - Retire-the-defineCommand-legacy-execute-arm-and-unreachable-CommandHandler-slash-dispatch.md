---
id: TASK-413
title: >-
  Retire the defineCommand legacy execute arm and unreachable CommandHandler
  slash dispatch
status: To Do
assignee: []
created_date: '2026-08-03 18:27'
labels:
  - 'size:M'
dependencies: []
priority: medium
ordinal: 413000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: types.ts and defineCommand.ts document a legacy mode where execute() receives a raw ChatInputCommandInteraction, but index.ts routes every chat-input through handleCommandWithContext, which always passes SafeCommandContext - all 19 defineCommand modules set deferralMode, and a dev following the documented legacy example would crash at runtime (context object where the example promises an interaction). CommandHandler.handleInteraction also retains an unreachable slash-command dispatch branch - its only caller is the modal-submit path in index.ts. Surfaced by the 2026-08-03 drift audit.
Fix shape: collapse the execute union to the context signature, delete the legacy docblock examples, remove the unreachable dispatch branch and its docblock, update tests.
Acceptance: execute union has one arm; CommandHandler.handleInteraction handles modal submits only (rename if warranted); typecheck + unit + component snapshots green.
<!-- SECTION:DESCRIPTION:END -->
