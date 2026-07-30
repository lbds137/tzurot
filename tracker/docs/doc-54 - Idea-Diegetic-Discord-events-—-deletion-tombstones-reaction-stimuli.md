---
id: doc-54
title: 'Idea: Diegetic Discord events — deletion tombstones + reaction stimuli'
type: other
created_date: '2026-07-30 02:45'
---

_Surfaced by the literal-goose / literal-raccoon character cards (owner exchange
2026-07-29): both cards write Discord itself as diegetic — deletions are "taken
by the raccoon," reactions are "tribute formally recorded," pings are
"unauthorized summonses." The design question from that exchange: which of those
clauses are live today, and which are inert because the platform never surfaces
the event?_

## What already reaches the model (verified 2026-07-29)

| Event                                                | State                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| @mention / ping                                      | ✅ live — it IS the trigger mechanism                                                                                                             |
| Reactions on recent messages (incl. the character's) | ✅ live but **passive** — `processReactions` snapshots the last N messages at context-build time → `<reaction>` XML per reactor per emoji         |
| Attachments (images, audio)                          | ✅ live — vision descriptions + STT                                                                                                               |
| Embeds                                               | ✅ live — `embedsXml` in extended context                                                                                                          |
| Message deletion                                     | ❌ **inverse of live** — `ConversationSyncService` soft-deletes the row (heal-on-read), so the message silently vanishes; no narration ever occurs |
| Message edit                                         | ❌ silent — history row content updates in place, no "edited" marker                                                                              |
| Reaction as a **stimulus** (react → character wakes) | ❌ no `messageReactionAdd` listener exists at all                                                                                                 |
| Stickers / polls                                     | ❌ no handling (filed separately as TASK-355 — pure context fidelity, no event plumbing)                                                          |

So the goose's tribute bit lands only when someone happens to speak after the
reaction; the raccoon's deleted-message bit can never land.

## Tier A — passive narration (cheap, no new model calls)

Deletion tombstones in rendered history: instead of the sync silently dropping
a soft-deleted row, the rendered context keeps a system line — `[a message from
X was deleted here]` (content NOT retained beyond what history already holds;
the narration is the fact of deletion, not a resurrection). Edits could get the
same optional treatment (`[X edited their message]`).

**The load-bearing design constraint**: Discord-organic deletion (a user deletes
their own message — a publicly observable channel event) must diverge from
tzurot-initiated data deletion. `/history purge`, `/settings data delete`, and
retention purges must stay **absolutely silent** — a privacy-driven deletion
that narrates its own tombstone into future prompts would partially defeat the
deletion (and the MemoryFact propagation work in #1796 set the precedent that
data-rights deletion reaches everything derived). Mechanically these paths are
already distinguishable: sync-observed disappearance (organic) vs. gateway
purge/erasure writes (data-rights). The tombstone belongs ONLY to the first.

Opt-in surface: plausibly a personality-level flag (most characters don't want
meta-narration; these two cards were built for it), or an extended-context
setting at the channel tier.

## Tier B — active stimuli (each one costs a model call; needs gating)

`messageReactionAdd` on a character's webhook message as a trigger — the goose
formally receives its tribute in real time. Cost/abuse reality: reactions are
free and spammable, so this needs hard gating before it exists at all —
activated-channel-only, per-channel cooldown, maybe reaction-count debounce
(respond once to the first reaction in a window, not once per reactor). A
cheaper middle path: reaction-add just *refreshes* the passive snapshot for the
next organic turn, guaranteeing the tribute is visible even if it aged out of
the last-N window.

Same active-stimulus shape could later cover deletion (raccoon investigates in
real time), but Tier A narration alone makes the bit land at the next turn for
zero marginal cost — build A before even scoping B.

## Related

- `doc-26` (message-actions design) — adjacent but distinct: that is bot-owned
  reaction **UI affordances** (🚩 Report Issue); this is character-visible
  **stimuli**. If both ship, the reaction listener is a shared seam — whichever
  lands second should reuse the first's listener plumbing.
- TASK-355 — sticker/poll context enrichment (independent, buildable now).
