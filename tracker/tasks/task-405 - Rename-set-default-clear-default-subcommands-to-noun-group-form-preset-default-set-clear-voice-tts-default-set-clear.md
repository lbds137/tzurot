---
id: TASK-405
title: >-
  Rename set-default/clear-default subcommands to noun-group form (/preset
  default set|clear, /voice tts default set|clear)
status: To Do
assignee: []
created_date: '2026-08-02 23:48'
labels:
  - 'area:bot-client'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 405000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner spotted 2026-08-02 that Wave 3 (the breaking-rename batch) left verb-suffix subcommands behind: /preset set-default + /preset clear-default (services/bot-client/src/commands/preset/index.ts) AND /voice tts set-default + clear-default (services/bot-client/src/commands/voice/tts/subcommandBuilder.ts). These are the only remaining hyphenated verb-suffix SUBCOMMANDS repo-wide (swept setName; other hyphenated hits are option names or deliberate command names like chime-in).
Fix shape: rename to the noun-group convention the rest of Wave 3 established - owner-suggested target /preset default set + /preset default clear (subcommand group), same for /voice tts. Breaking rename: follow the Wave-3 PR pattern (builder + handlers + routing + component customIds if any + CommandHandler.component.test.ts snapshots + docs/commands.md + README sweep). Also audit the free-default name at preset/index.ts:371 for family membership while in there.
Belongs to: UX epic Phase-3 rename family (parked home doc-14); standalone PR-sized.
Acceptance: no set-default/clear-default subcommand names remain; command snapshots + docs updated; release notes flag the breaking rename.
<!-- SECTION:DESCRIPTION:END -->
