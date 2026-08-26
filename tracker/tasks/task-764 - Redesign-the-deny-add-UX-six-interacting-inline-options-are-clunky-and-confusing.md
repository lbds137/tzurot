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

DESIGN SETTLED 2026-08-26 — owner picked the guided-flow direction (scope-first subcommands) over the interactive builder and over validation-only. Reasoning recorded because the other two were live options: the builder adds session state, custom-ID routing and expiry failure modes, and is SLOWER to drive in exactly the live moderation moment this was reported from; validation-only fixes the "did it work?" half but leaves "you must already know the option model", which is the half the owner called confusing.

Shape, grounded in the code rather than the task's sketch:

  /deny add {bot|server|channel|character}
  /deny remove {bot|server|channel|character}
  /deny browse, /deny view unchanged

Discord subcommand GROUPS, not new top-level commands — the sketch's `/deny user-in-channel` would multiply out across type × scope. `add` and `remove` become groups; scope becomes the subcommand. Precedent verified in this codebase, not assumed from Discord docs: preset/index.ts, memory/index.ts, settings/index.ts and admin/index.ts all use addSubcommandGroup, and preset/index.ts:141 shows the routing pattern — context.getSubcommandGroup() selects a per-group router, each group keeping its own flat subcommand router. A flat router keyed on subcommand name alone would collide, since add and remove would both carry a `channel` subcommand.

`type` (USER/GUILD) DISAPPEARS as an option. Each scope subcommand instead exposes `user:` (a native Discord user option) and `server:` (string ID), exactly one required — the entity type is inferred from which one was filled. This is what removes the hand-typed snowflake: `target` is currently addStringOption described as "Discord user or server ID", dual-purpose precisely because it must accept both, and that dual purpose is why it cannot be a picker. Splitting it is what makes the picker possible, which in turn kills the display-name mismatch in the confirmation.

REMOVE gets the same treatment, not just add. The task names only `add`, but remove carries the identical six-option shape (index.ts, the remove subcommand) — fixing one leaves the confusion one subcommand over.

Landmines for the build: command structure changes require `pnpm test:component` (CommandHandler snapshots capture the full command tree, per 02-code-standards). The three-tier permission model (owner all scopes, mods GUILD+CHANNEL in their guild, character creators PERSONALITY for their own) is enforced at runtime and must be preserved per-subcommand — the restructure must not become an access-control change. Confirm whether a command may mix subcommand GROUPS with plain subcommands (browse/view stay flat) before committing to the shape.
<!-- SECTION:DESCRIPTION:END -->
