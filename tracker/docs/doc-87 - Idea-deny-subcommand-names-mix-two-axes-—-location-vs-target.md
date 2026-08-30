---
id: doc-87
title: 'Idea: /deny subcommand names mix two axes — location vs target'
type: other
created_date: '2026-08-30 22:05'
---

_Focus: `/deny`'s subcommand slot answers "where" for four entries and "what" for one, so the picker never says what is actually being denied._

## Provenance

Owner verdict from the live picker check on PR #2262 (2026-08-30), the acceptance clause on TASK-787:

> "it's a little confusing because it mixes concepts of targets. Like, you've got the notion of... if you specify location, like, deny channel or deny this server or deny everywhere, that kinda doesn't give information about what is being denied. I mean, the implication is that it's a user, but I feel like that's confusing. And then you have deny add server which isn't about the location, per se. I mean, it kinda is. The server is both a location and a target. But semantically, I feel like it's a little bit muddied."

And the disposition, same message: _"this is probably an improvement over how the deny command used to work, but I wouldn't say this is the final state."_ TASK-787 was closed on that basis — its own scope (kill the dual-optional target; one required target per subcommand) is done and pinned by tests. This doc owns the part that survived it.

## The problem, stated structurally

`/deny` has TWO orthogonal dimensions:

- **Target** — who or what is denied: a user, or a whole server.
- **Scope** — where the denial applies: bot-wide, one guild, one channel, one character.

Discord gives exactly ONE naming slot for them. Depth is capped at command → subcommand-group → subcommand, and `add`/`remove` already consumes the group level. So one axis must collapse into options, or go unnamed.

Today the subcommand names the SCOPE (`everywhere`, `this-server`, `channel`, `character`) and the target rides as a required option — except `server`, where the subcommand names the TARGET. Hence the muddle: four entries answer "where" and leave "who" implicit, one answers "what".

**The asymmetry underneath is real, not just a naming slip.** A server denial has no scope choice at all — it is bot-wide by definition on this surface. So `server` is not a mis-named scope; it is a different operation that got filed under a scope-shaped menu because there was nowhere else to put it.

## Constraint discovered during the check — Discord sorts subcommands ALPHABETICALLY

The rendered picker showed: `channel`, `character`, `everywhere`, `server`, `this-server`. Registration order in `buildScopeGroup` is `everywhere`, `server`, `this-server`, `channel`, `character`. **The picker ignores registration order.**

This matters for any redesign: **adjacency cannot be designed by ordering the builder calls — only by choosing names that sort adjacently.** PR #2262's commit message and body both asserted `server` "sits beside `everywhere` in registration order"; that claim was never verified against a client and the screenshot falsifies the mechanism. The outcome happened to match by alphabetical luck. Do not repeat the claim.

## Directions, none chosen

1. **Descriptions carry the target (INTERIM — shipping now).** Make every scope subcommand's description name the user explicitly, so the picker stops being silent about what is denied. `everywhere` and `server` already do; `this-server`, `channel`, `character` do not. Does not fix the axis muddle — it stops the muddle being invisible.
2. **Free the nesting level by moving add/remove to the command axis.** `/deny user {everywhere|this-server|channel|character}` + `/deny server`, with `/undeny user {...}` + `/undeny server`. The group then names the TARGET and the leaf names the SCOPE, and both axes are honest. Costs: a second top-level command, and `/undeny` is a coined word. Note `/allow` would be wrong — removing a denial is not adding an allowance.
3. **Target-first with scope as an option** — `/deny add user <user> scope:<...>`. Coherent, but it reintroduces conditionally-relevant options (scope=channel needs `channel:`, scope=character needs `character:`), which is precisely the defect TASK-764 removed. Listed so nobody re-derives it as new.
4. **Rename for alphabetical grouping.** Given the sorting constraint above, names could be chosen so related entries sort together (e.g. a shared prefix). Cheap-ish, but prefixes make every name longer and read worse in isolation.

## Not in scope

The `server`/`GUILD` terminology overload (`GUILD` is both a `DenyEntityType` and a `DenyScope` value). claude-review raised it on #2262 and it was dispositioned correct-as-is: those are two genuinely different concepts, renaming the entity type requires a DB enum migration, and renaming `this-server` reverses an owner naming call. If a redesign here happens anyway, revisit it then — but it is not the reason to do one.

## What is already done, so it is not redone

PR #2262 (TASK-787) made every `/deny add|remove` subcommand take exactly one required target option and deleted the user/server XOR that arbitrated the old dual-optional shape. That is the shape defect. This doc is about the naming axis, which predates it and survives it.
