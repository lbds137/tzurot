---
id: TASK-764
title: >-
  Redesign the /deny add UX - six interacting inline options are clunky and
  confusing
status: To Do
assignee: []
created_date: '2026-08-24 15:34'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 764000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: direct owner feedback while wielding the command in a live moderation situation - "that command really needs some UX love, it feels so clunky and confusing. I think I did it right though". The add subcommand exposes six inline options (target, type, scope, channel, character, reason, mode) whose semantics interact - scope decides whether channel or character is read, type changes what target means - so the user must already know the option model to fill the picker correctly, and a mis-set combination fails only after submit. Even a successful use left the owner unsure it had worked.

Fix shape: needs a design pass first. Candidate directions: a guided flow (scope-first subcommands like /deny user-in-channel, /deny user-from-character - the scope choice becomes the command name and irrelevant options disappear); or an interactive builder (ephemeral embed + select menus, the dashboard pattern in utils/dashboard/); or at minimum contextual validation with error messages naming the exact option conflict. Confirmation copy should echo back BOTH username and display name plus the scope in plain words (the current confirmation resolved a different display name than the owner typed, forcing a snowflake double-check).

Acceptance: owner can complete the two common moderation flows (deny user in channel, deny user from character, both with mute) without consulting docs, and the confirmation makes the resolved target unambiguous.
<!-- SECTION:DESCRIPTION:END -->
