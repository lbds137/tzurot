---
id: TASK-414
title: Remove dormant back-compat shims with zero production consumers
status: Done
assignee: []
created_date: '2026-08-03 18:27'
updated_date: '2026-08-03 21:14'
labels:
  - 'size:S'
dependencies: []
priority: medium
ordinal: 414000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-08-03 drift audit verified these compat layers have no non-test consumers: DiscordChannelFetcher extractReactions/collectReactorUsers wrappers (production uses ReactionProcessor module functions directly); the named-export fallback in CommandHandler/deployCommands command loading (every command file has a default export); preset/dashboardButtons.ts re-export of buildPresetDashboardOptions (all importers use ./config.js); messageTypeUtils.ts isForwardedMessage re-export (live importers use forwardedMessageUtils/references-types; getEffectiveContent in the same file IS live - keep it); ai-worker MemoryRetriever.getPersonaContent (deprecated, superseded by getPersonaData, test-only).
Fix shape: delete each shim and retarget the tests that import them at the live modules.
Acceptance: all five shims gone; tests assert against live modules; pnpm test + knip green.
<!-- SECTION:DESCRIPTION:END -->
