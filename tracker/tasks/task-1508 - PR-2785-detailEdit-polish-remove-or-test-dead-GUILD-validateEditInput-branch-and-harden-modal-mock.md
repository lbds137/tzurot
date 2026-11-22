---
id: TASK-1508
title: >-
  PR 2785 detailEdit polish: remove or test dead GUILD validateEditInput branch
  and harden modal mock
status: To Do
assignee: []
created_date: '2026-11-22T07:39:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1508000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2785 (TASK-1327) omitted Scope and Scope ID inputs from the GUILD deny-edit modal and submits BOT and * directly in handleEditModal (services/bot-client/src/commands/deny/detailEdit.ts). Claude review left four low/nit follow-ups.
What: (1) delete or directly test the now-unreachable entityType === GUILD && parsedScope !== BOT branch in validateEditInput (and sync its JSDoc if deleted); (2) make createMockModalInteraction in detailEdit.test.ts throw on absent field keys (matching discord.js) so GUILD tests drop the duplicated mock override; (3) readability polish in detailEdit.ts (positive data.type === GUILD ternary in handleEdit, single isServerDenial const in handleEditModal); (4) optionally add a regression test for migrating a legacy non-BOT GUILD row to BOT and/or mention bot-wide-only in the GUILD reason placeholder.
Acceptance: dead branch either removed or unit-tested; createMockModalInteraction throws on missing keys; bot-client tests and lint pass.
<!-- SECTION:DESCRIPTION:END -->
