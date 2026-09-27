---
id: TASK-1117
title: doc-audit skill deletes shared memory files without an owner yes
status: To Do
assignee: []
created_date: '2026-09-27 09:48'
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

What: rewrite the Migrate and Delete actions and the step list so the audit writes the destination first, then lists each memory file it proposes to delete (with its index line and the destination that now carries it), and deletes only after the owner's explicit yes. Also check whether the skill's memory path (`~/.claude/projects/*tzurot*/memory/`) and `07-documentation.md`'s description of auto-memory still match the shared directory, and fix what does not.

Acceptance: no step in the skill deletes a memory file without an owner-yes gate; the path the skill names is the real memory directory; the change lands via PR (skills are review-gated).
<!-- SECTION:DESCRIPTION:END -->
