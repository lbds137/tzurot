---
id: TASK-852
title: bot-client index.ts is at its 600-line eslint ceiling
status: To Do
assignee: []
created_date: '2026-09-01 14:03'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 852000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/index.ts measures exactly 600/600 counted lines (skipBlankLines+skipComments, elevated max-lines override) after the gateway-watchdog wiring (PR 2286). The NEXT line added to the file fails pnpm lint - every future boot-path feature pays this toll first. Measured 2026-09-01 with the eslint one-liner from 02-code-standards.

Fix shape: extract a cohesive region from the entrypoint into a module (candidates: the scheduler start/stop block, the client event registrations, or the shutdown/dispose wiring) with its colocated test where logic warrants one. Per 02-code-standards, the fix is extraction - never comment trimming.

Acceptance: index.ts has real headroom (target under ~550 counted) and pnpm lint stays green.
<!-- SECTION:DESCRIPTION:END -->
