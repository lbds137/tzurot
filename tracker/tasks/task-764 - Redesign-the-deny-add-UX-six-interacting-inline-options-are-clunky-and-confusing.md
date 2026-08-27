---
id: TASK-764
title: >-
  Redesign the /deny add UX - six interacting inline options are clunky and
  confusing
status: To Do
assignee: []
created_date: '2026-08-24 15:34'
updated_date: '2026-08-27 00:28'
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

CODE SHIPPED 2026-08-26 in PR 2233. Task stays OPEN on the first acceptance clause only. Three review rounds, none blocking.

  1. "owner can complete the two common moderation flows without consulting docs" — NOT VERIFIED, and not verifiable by the agent. This clause is about the owner's experience of the interface. The structure supports it (`/deny add channel user:@x channel:#y mode:Mute` and `/deny add character user:@x character:Z mode:Mute`), but whether that reads as obvious to the person typing it is the owner's judgement, not something a test or a review can settle.
  2. "the confirmation makes the resolved target unambiguous" — MET. The line now carries display name, account handle and snowflake together plus the scope in plain words, and both the display name and the character name are markdown-escaped with tests pinning that a crafted name cannot reshape it.

CLOSE WHEN: the owner runs both flows and confirms they read right. The specific open question is the subcommand naming — `everywhere` and `this-server` were the agent's choice, not the owner's, and they are the words the owner has to type. `everywhere` vs something like `bot-wide`, and `this-server` vs `server`, are one-line changes if either reads wrong.

Note for whoever closes this: an agent marked this Done at ship and reverted it in the same minute. The acceptance is experiential; shipping the code does not satisfy it, and a green CI run is not evidence about clause 1.

Follow-ons, all filed rather than left in the PR: TASK-765 (thread types on the channel option, deliberately sequenced AFTER this so it applies to the new structure rather than being done twice), TASK-779 (the codegen skips subcommand groups, so deny lost its generated option schemas — no consumers, pre-existing for every grouped command). Also still open from the ux-design-system-spec §4.5 section this supersedes: `remove`/`view` autocomplete from existing entries, badges + BLURPLE list, and the non-owner component-click ghost.
<!-- SECTION:DESCRIPTION:END -->
