---
id: TASK-1423
title: Allow editing an alias scope in /character alias browse instead of delete-only
status: To Do
assignee: []
created_date: '2026-11-14T17:04:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1423000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Owner UX report (2026-11-14): `/character alias` browse currently only allows deleting an alias (`Remove Alias?` confirmation on single-select and batch removal on multi-select), with no way to edit an existing alias's scope (`Personal 🔒` <-> `Global 🌐`) in place without deleting and recreating it.

Verified codebase state:
- Bot client single-select (`services/bot-client/src/commands/character/aliasBrowse.ts:218-250`): `handleAliasSelect` immediately renders a delete-only confirmation (`buildConfirmAction` with `RM_YES_PREFIX` / `RM_NO_PREFIX` at `aliasBrowse.ts:35-36,232-249`). Multi-select (`services/bot-client/src/commands/character/aliasBatch.ts:1-50`) likewise supports batch removal only.
- Gateway & client (`services/api-gateway/src/routes/user/personality/aliases.ts:461-474`): routes exist only for list (`handleListPersonalityAliases`, `handleListMyAliases`), create (`handleAddPersonalityAlias`), and delete (`handleRemovePersonalityAlias`). There is no `PATCH` endpoint (or `UserClient` method) to update an existing alias's `scope` (`'user'` <-> `'global'`).

What:
1. API gateway + `api-client` (`services/api-gateway/src/routes/user/personality/aliases.ts` + OpenAPI route/client): add an alias scope-update endpoint (e.g. `PATCH /user/personalities/:personalityId/aliases/:alias` or by alias id/name matching `DELETE`) that flips `scope` between `'user'` and `'global'`, enforcing the same ownership/visibility checks, global-alias permission/collision rules, `rejectIfShadowed` / reverse-shadow warnings (`aliases.ts:262-310`), and alias-resolution cache invalidation as add/remove.
2. Bot client (`services/bot-client/src/commands/character/aliasBrowse.ts:218-250`): when selecting an alias in `/character alias` browse, present an item action view offering both **Change Scope** (`Make Global 🌐` when currently `user`, `Make Personal 🔒` when currently `global`) and **Remove Alias**, returning to the refreshed browse page (surfacing any shadow warning/collision error cleanly).

Acceptance:
- Selecting an alias in `/character alias` browse lets the user toggle its scope between `Personal` (`user`) and `Global` (`global`) in place, as well as remove it.
- Promoting `user` -> `global` rejects collisions with an existing global alias and enforces character visibility/ownership rules identically to `handleAddPersonalityAlias`; demoting `global` -> `user` updates scope cleanly and invalidates cached alias resolution.
- Gateway route unit/contract tests + `aliasBrowse.test.ts` interaction tests cover both scope transitions, collision/permission rejection, and refreshed browse state.
<!-- SECTION:DESCRIPTION:END -->
