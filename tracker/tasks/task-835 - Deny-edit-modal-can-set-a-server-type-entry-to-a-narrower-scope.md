---
id: TASK-835
title: Deny edit modal can set a server-type entry to a narrower scope
status: To Do
assignee: []
created_date: '2026-08-30 20:53'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 835000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found while shipping TASK-787 (the /deny add|remove server split). The slash-command surface now guarantees a server (GUILD entity type) denial is always BOT scope — only the `server` subcommand exposes a server target, and it maps to BOT. The detail EDIT MODAL does not honor that. validateEditInput (services/bot-client/src/commands/deny/detailEdit.ts:145) parses the submitted scope via parseScopeInput and validates only two things: that the scope is one of the four, and that BOT scope carries scopeId `*`. It never consults the entry entity type. So an owner editing an existing server-type entry can set its scope to GUILD, CHANNEL, or PERSONALITY, producing a stored row the add/remove surface cannot create.

This is why the denyTarget.ts module docstring on that PR was reworded: an earlier draft asserted "a server denial is only ever bot-wide", which the claim-shape commit guard flagged and this path falsifies. The docstring now explicitly warns readers not to treat it as an invariant over stored rows.

Open question, and the reason this is filed rather than fixed inline: it is not established whether a GUILD-type entry at CHANNEL or PERSONALITY scope is incoherent or merely unusual. DenylistCache lookups are keyed by type plus scope plus scopeId, so such a row would simply match narrowly — "this server is denied in this one channel" is semantically readable. Decide the intent BEFORE writing a guard; a validation rule added on the assumption it is nonsense could remove a capability someone wants.

Fix shape (after the intent call): if server denials should be bot-wide only, validateEditInput takes the entry entity type and rejects a non-BOT scope for GUILD-type entries, with a colocated test per scope. If narrow server denials are legitimate, no code change — instead pin the intent with a test and drop the warning paragraph from the denyTarget.ts docstring.

Acceptance: the intended semantics for a GUILD-type entry at non-BOT scope is written down; the edit modal either enforces it or is documented as deliberately permissive; a colocated test pins whichever was chosen.

Owner question: Is a GUILD-type denial at CHANNEL or PERSONALITY scope a legitimate capability, or incoherent state the edit modal should reject?
Recommendation: Legitimate — document the modal as deliberately permissive and pin it with a test, because DenylistCache already keys on type plus scope plus scopeId so such a row matches narrowly and reads as "this server is denied in this one channel", and the task warns that a guard written on the assumption it is nonsense could remove a capability someone wants.
<!-- SECTION:DESCRIPTION:END -->
