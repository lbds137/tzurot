---
id: TASK-1341
title: >-
  Machloket e2e first unit: pin the Discord transport contract against a
  throwaway server
status: To Do
assignee: []
created_date: '2026-11-02T13:20:00Z'
labels:
  - area:tests
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1324000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: doc-114 first unit. Discord-local was the blocker for end-to-end tests; a throwaway Machloket server removes it.

What: a local e2e tier (pnpm test:e2e, *.e2e.test.ts under tests/e2e/machloket) that boots the Machloket server e2e harness and drives discord.js with the real bot-client options (buildDiscordClientOptions, discordRestOptions) through message, webhook, DM, gateway, slash, component and error-code surfaces. Each known server gap is a plain test asserting what the server does today, so it goes red when the server fixes it.

Acceptance: pnpm test:e2e passes locally with MACHLOKET_SERVER_DIR set; without it the run fails naming the variable; pnpm test, test:component and test:integration do not collect the new files; TESTING.md records the tier.

Not covered: Tzurot handlers, because getConfig only accepts an https origin and the harness is http (doc-114 Later units).
<!-- SECTION:DESCRIPTION:END -->
