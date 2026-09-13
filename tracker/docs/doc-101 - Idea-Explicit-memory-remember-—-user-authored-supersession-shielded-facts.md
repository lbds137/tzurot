---
id: doc-101
title: 'Idea: Explicit /memory remember — user-authored, supersession-shielded facts'
type: other
created_date: '2026-09-13 17:24'
---


### Idea: Explicit `/memory remember` — user-authored, supersession-shielded facts

_Source: the shapes.inc announcements mined 2026-09-13 (owner-supplied export, April–September 2026). Their 2026-09-05 update: "When you explicitly ask a Shape to remember something, it can now save that information for the current chat … Memories can remain within the current chat or be shared across chats in the same workspace." Owner note at filing: theirs is probably agentic (the character decides to store via a tool); Tzurot's agentic scaffolding (`docs/proposals/backlog/agentic-scaffolding.md`) is a deliberately deferred boulder — "shore up the other stuff first" — so THIS idea is the non-agentic shape only._

**Why it fits.** The fact layer already has the piece that makes user-authored memory safe: `memory_facts.tier = corrected` is shielded from automatic supersession (FactStore; recorded in TASK-671). A user-authored fact is a corrected-tier fact by construction. This attacks TASK-671 from the user side — "I am not seeing X anymore" becomes a fact the owner writes once, instead of a correction extraction has to notice in dialogue (which it repeatedly did not, per the third sighting recorded there).

**Shape (the whole idea, one slice):**
- `/memory remember character:<autocomplete> text:<statement>` → gateway route → one `memory_facts` row: subject normalised to the `{user}` placeholder like extraction does, `tier: corrected`, an entity tag `authored:user`, salience high. Ephemeral confirmation echoing the stored statement.
- Optional second option `replaces:<fact autocomplete>` that sets `supersededById` on an existing fact in the same write, for the "that is no longer true" case; without it the new fact stands alone.
- Render: nothing new — the `<facts>` block already frames its contents as "distilled, CURRENT knowledge", and corrected-tier facts already render there.
- Scope: facts are per persona × personality today, so "remember for this character" is the natural unit. A channel-scoped memory has no home in the schema; do not invent one for this slice (note it as the shapes.inc "current chat" variant we skip).

**Not in scope:** the agentic form (the character choosing to remember mid-conversation through a tool call). That belongs to the agentic proposal and is promoted only when that boulder is picked up. Also out: bulk import of remembered facts, and any UI beyond the slash command.

**Dependencies:** TASK-959 (a tag filter on `/memory facts`) makes authored facts reviewable; TASK-671 is the problem this serves.

**Acceptance sketch:** a fact authored through the command appears in the character's `<facts>` block on the next turn, survives the next extraction pass (not auto-superseded), and can be forgotten through the existing `/memory facts` flow.
