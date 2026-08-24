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
Additional members from the PR 2206 round-2 review inventory: ~~MessageHandler missing-or-invalid-content branches~~ (ABSORBED: shipped in PR 2207 alongside the multi-tag/DM-session sweep), the saveAssistantMessageFromFields persist-failure catch, and a DECIDE-whether item: the two defer-failure paths (commandDispatch DeferFailedError + context-menu defer catch) currently bypass the reporter deliberately - defer failures are usually transient interaction expiry and would be noisy; confirm or wire when picking this up.
One more fidelity member (PR 2206 round-3 informational): the reporter's windowCache/historyCache LRU cap (200) means >200 distinct error hashes in an hour can evict an entry and silently drop a later suppressed-count field - unlikely at this scale; note it in the module doc or bump the cap when picking this up.
One design member (PR 2207 round-1 observation): reportJobError posts with no error object, so its dedup hash falls back to the bare category string - every job error sharing a category collapses into ONE 1-hour dedup bucket, and PR 2207 raised the fan-in to 5+ call sites (multi-tag slot errors, submit failures, DM-session, mention/slash, boundary branches). Not silent loss (the suppressed-count surfaces on the next post), but decide when picking this up whether category-only keying still fits - e.g. mix requestId-stable material or a per-source salt into the hash.
Acceptance: each catch reports with a test (or carries a documented decline); deny/skip semantics unchanged.
<!-- SECTION:DESCRIPTION:END -->
