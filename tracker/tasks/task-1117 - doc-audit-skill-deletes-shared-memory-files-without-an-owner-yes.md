---
id: TASK-1117
title: doc-audit skill deletes shared memory files without an owner yes
status: Done
assignee: []
created_date: '2026-09-27 09:48'
updated_date: '2026-09-27 11:12'
labels:
  - 'area:skills'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: `.claude/skills/tzurot-doc-audit/SKILL.md` § the auto-memory verdict table (the three Migrate rows and the Delete row) and the ordered steps under it (write destination, then "Delete the memory file", then update MEMORY.md) tell the auditing session to delete memory files itself. The memory folder (`/home/deck/Documents/claude-memory/`) is shared by every Claude session on the Deck, so harness `core.md` § Fix recurring failures structurally says: when a memory is promoted into a rule, skill or hook, PROPOSE deleting the memory and its index line, and delete only on the owner's yes. Raised by the Deck-management session on 2026-09-27 as a leftover of the 09-25 doc audit.

What (reshaped 2026-09-27, owner steer: machine-local memory management belongs in the harness, not Tzurot): `harness:doc-audit` (`claude-harness/plugins/harness/skills/doc-audit/SKILL.md`) already audits the shared memory correctly, with the owner-yes gate and the real `autoMemoryDirectory`. So cut the Tzurot skill's § 0 (auto-memory audit) to a pointer to `harness:doc-audit` instead of repairing it. Correct `.claude/rules/07-documentation.md`'s auto-memory note and placement bullet: the real path is `~/Documents/claude-memory`, shared by every session on this machine (not "visible only to one Claude instance"), and still not a fourth durable layer. Keep `memory-prune` in `backlog/cadence-ledger.json` but point it at `harness:doc-audit`. Dropping it, and `usage-audit`, is TASK-1118, after the harness cadence ledger ships (agreed with the Harness session). Also sweep other copies of the old path: `git grep -n "projects/\*tzurot\*/memory"`.

Acceptance: nothing in Tzurot deletes a memory file; the Tzurot skill points at `harness:doc-audit` for the memory pass; 07-documentation names the real shared directory; the change lands via PR (skills and rules are review-gated).
<!-- SECTION:DESCRIPTION:END -->
