---
id: TASK-1582
title: 'Message context menus: reroll and edit response actions'
status: In Progress
assignee:
  - Tzurot
created_date: '2026-11-28T01:10:00Z'
updated_date: '2026-11-28T02:02:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1572000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila ask 11-27 for the next release (relayed via Deck): context / app menu options to reroll a response and/or edit the response (with a modal or something). Sits beside TASK-1558/1559 (Chime In and Edit Character message actions, shipped in beta.252). What: right-click a character reply then Apps then Reroll (regenerate that response; semantics to propose: old response kept or replaced in history, incognito carry, billable-generation accounting) and Apps then Edit Response (modal to edit the message text; semantics to propose: memory extraction on edited text, edited-marker and provenance rendering). Acceptance: reroll + edit semantics proposed to Lila and approved before build; menus follow the Chime In / Edit Character command pattern; component tier pins command structure; unit tests pin the regeneration and edit paths.

Owner rulings 2026-11-27 (AskUserQuestion, all four recommended picks): (1) Replace: reroll edits the same Discord message(s) in place with the new text; the old history row is soft-deleted and the old exchange memory removed, so the character only remembers the new reply. (2) Latest only: only that character's most recent reply in the channel can be rerolled (history hydration has no point-in-time cutoff). (3) Turn owner + bot owner: only the user owning the row's persona, or the bot owner, may Reroll or Edit; a reroll bills that user as one ordinary generation. (4) Rewrite memory: Edit Response rewrites the exchange's long-term memory to the edited text and re-embeds it; facts already extracted stay. Incognito is sticky as in Chime In. Full proposal and build notes (the 1h processed lock, the deterministic row id, propagateDeletionToMemories having no personality filter, the modal deferral opt-out): docs/local/task-1582/design.md (local).

Owner rulings 2026-11-28 (Edit Response, PR A #2833, merged): (a) the exchange memory always stays in sync: an edit whose memory cannot follow it is refused before Discord changes; (b) a locked memory refuses the edit with "This reply's memory is locked. Unlock it in /memory to edit."; (c) coalesced replies: every memory holding the reply is rewritten (other users' and the editor's own earlier triggers included), and any locked one refuses the whole edit; (d) TTS on edit: regenerate audio (TASK-1585). PR A shipped; PR B (Reroll) remains.

Owner ruling 2026-11-28 (Reroll, PR B): when the bot owner rerolls another user's reply, it runs and bills as the turn owner (their persona, config, key and billing), exactly as if they had rerolled it. Derived for PR B from rulings (a)–(c), not separately asked: every memory holding the old reply is removed, and any locked one refuses the reroll before generation.

Carried from #2833 review r6 (nits, for PR B in the same files): stale "other personas only" wording in two `historyEditMemory.test.ts` titles and the `SiblingCandidate` docblock; rename `memoryBlocker`'s `editorPersonaId` to `turnPersonaId`.
<!-- SECTION:DESCRIPTION:END -->
