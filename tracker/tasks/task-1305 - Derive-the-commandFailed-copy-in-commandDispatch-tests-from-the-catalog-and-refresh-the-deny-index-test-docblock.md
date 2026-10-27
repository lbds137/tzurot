---
id: TASK-1305
title: >-
  Derive the commandFailed copy in commandDispatch tests from the catalog and
  refresh the deny index test docblock
status: To Do
assignee: []
created_date: '2026-10-27T05:45:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1290000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2670 review round 2. That PR couples the interaction-failed assertions to the catalog; the command-path sibling still hardcodes its copy, and a file docblock lags the file.

What: (1) services/bot-client/src/handlers/commandDispatch.test.ts, around lines 303 and 333, asserts the literal error-executing-this-command sentence; switch both to renderSpec(CATALOG.error.commandFailed()) (the literal stays pinned in ux/render/reply.test.ts); (2) extend the header docblock of services/bot-client/src/commands/deny/index.test.ts (lines 1-9) to mention the handleButton and handleSelectMenu routing and rejection-propagation coverage.

Acceptance: both edits land; a one-character change to the commandFailed catalog text reddens only reply.test.ts and the catalog test; no source change.
<!-- SECTION:DESCRIPTION:END -->
