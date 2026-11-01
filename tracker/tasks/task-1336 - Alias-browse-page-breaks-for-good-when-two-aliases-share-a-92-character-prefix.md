---
id: TASK-1336
title: Alias browse page breaks for good when two aliases share a 92-character prefix
status: To Do
assignee: []
created_date: '2026-11-01T20:25:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1319000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/commands/character/aliasBrowseView.ts formatAliasSelectValue cuts the alias to SELECT_ALIAS_KEY_LENGTH (92) while the column allows 100 (prisma/schema.prisma PersonalityAlias.alias), so two same-scope aliases sharing that prefix on one page give duplicate option values, and services/bot-client/src/utils/browse/selectMenuBuilder.ts throws on duplicates. TASK-1332 adds a catch to the batch entry and pick handlers, but the message it sends reads as transient and a retry cannot help. Code-reading only; not reproduced at runtime.
What: render such a page without a throw, in the batch menu and the single-select browse menu (check renderAliasBrowse in aliasBrowse.ts and whether its menu goes through the same builder), keeping display numbers correct, or cap alias length at 92 at creation and migrate.
Acceptance: a test with two such aliases on one page renders the view and the ambiguous pick still fails closed.
<!-- SECTION:DESCRIPTION:END -->
