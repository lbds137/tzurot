---
id: TASK-657
title: 'Add characters to the participants roster, like users'
status: Done
assignee: []
created_date: '2026-08-18 13:17'
updated_date: '2026-08-18 20:40'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 657000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
SCHEDULED: beta.205, by owner directive 2026-08-18 (see backlog/now.md > Next Release).

Why: owner intake 2026-08-18, during PR #2141 review. Characters are non-human users -- their details belong in the <participants> roster the same way persona details do.

The concrete gap: from_id is emitted ONLY for role="user" messages, bound to personaId (conversationUtils.ts:135-139). Character and assistant messages carry no from_id at all, because there is nothing in the roster for them to bind to. ParticipantFormatter.ts:225 instructs the model "Match from_id attribute in chat_log messages to participant id attribute" -- an instruction that structurally cannot resolve for any character line.

This is what makes a forwarded CHARACTER quote unable to carry a meaningful from_id (PR #2141): the correct value has no roster entry to point at. Fixing the roster is what makes the attribute worth emitting.

Scope guard from the owner: grab only characterInfo, NOT the full personality record. The roster is in every prompt, so bloating it costs tokens on every single turn -- pick the minimum that identifies the character to the model.

Fix shape: extend the participants section to include the personalities present in the window alongside personas, with an id the chat_log from_id can match. Decide whether characters and personas share one id space or get distinguishing markup -- they are different kinds of entity and the model should probably know which is which.

Owner nuance 2026-08-18: do NOT include characterInfo for the character
CURRENTLY SPEAKING -- that personality already gets its full character card in
the system prompt, so a roster entry for it is pure duplication paid on every
turn. The roster addition covers the OTHER characters present in the window.
Note this makes the roster response-scoped rather than window-scoped: the same
channel assembled for personality A and personality B yields different rosters,
which the implementation has to thread rather than cache per channel.

Acceptance: a character line in chat_log carries a from_id that resolves to a participants entry; the currently-speaking personality is absent from the roster while sibling characters are present; the roster addition is bounded to characterInfo-sized fields; a token-cost comparison before/after is stated rather than assumed.

## Council pass 2026-08-18 (GLM 5.2, Kimi K3, Qwen 3.8 Max, DeepSeek v4 Pro -- all four answered)

UNANIMOUS (4-0) on content, and it is the load-bearing half -- markup matters
less than the register of the text inside it:
- Third person only. No "I", no "You are". A quoted first-person excerpt
  reproduces the exact vector of the documented bleed, in a more dangerous
  genre (a sibling card is the same GENRE as the speaker's own card).
- Declaratives only -- no imperatives, no example dialogue. Behavioural detail
  is the most adoptable content.
- Short: 1-3 sentences, paid every turn.
- Per-entry, in-band, name-first frame ("Kai is a separate AI character").
  A block-level preface as the SOLE guard is the failed ancestor mechanism
  rewritten in prose.
- source="user_input" cannot be reused; siblings are system/author-authored.
- The roster alone fixes nothing: role="character" lines must actually be
  EMITTED with from_id, or the instruction claims a binding that does not exist.

SPLIT 3-1 on structure: GLM/Qwen/DeepSeek want a structurally distinct element
for siblings; Kimi wants one <participant> element distinguished by its child
element, arguing lookup uniformity. Kimi's objection is answerable -- all four
keep ONE id space, so "match from_id to any id in <participants>" stays a
single rule regardless of element name. Distinct element wins on the argument,
not the count.

CORRECTION to my own reasoning, from Kimi: "attributes failed" was my
overgeneralisation. from_id/id matching IS attribute-based and works. The
incident showed only that an attribute cannot be the SOLE carrier of a
not-you binding across long self-referential text. Provenance metadata on an
attribute is fine.

CODE-GROUNDED CORRECTIONS the panel could not know (verified, file:line):
1. <character_info> IS ALREADY TAKEN. PersonalityFieldsFormatter.ts:108 maps
   characterInfo -> <character_info> inside the SPEAKER's own card. GLM's and
   Kimi's proposed tag collides with the self-card. DeepSeek's <character>
   element for siblings collides with <system_identity><character>. Only
   Qwen's <peer_info> naming collides with nothing.
2. Register hazard is confirmed in the data, not hypothetical:
   ShapesPersonalityMapper.ts:186 sets characterInfo from config.user_prompt
   -- imported characters get instruction-register text in this field. Using
   characterInfo verbatim IS the truncation-preserves-register failure all
   four warned about.
3. Cache tier is NOT a problem. The module header of ParticipantFormatter.ts
   forbids speaker-derived bytes because they break the S1 prefix -- but that
   means the HUMAN speaking this turn. <system_identity> already makes the S1
   prefix personality-specific, so excluding the currently-speaking character
   costs zero extra invalidation. The owner's nuance is free.

TWO BLOCKING FINDINGS -- these outrank the markup question entirely:
4. SIZE: characterInfo is capped at DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH =
   4000 chars (personality.ts:427-429), not a short field. Verbatim inclusion
   is up to 4000 chars PER SIBLING PER TURN, in the same size class as the
   ~2000-char bio that caused the documented bleed.
5. PRIVACY -- the real blocker: `definitionPublic` defaults to FALSE
   (schema.prisma:429-437). characterInfo is redacted to null for non-owners
   on the GET personality route BY DEFAULT. Injecting a sibling's
   characterInfo into a different owner's character's prompt would route a
   private character definition to a third party, and from there potentially
   into model output. This is a data-rights decision, not an engineering one
   -- owner's call per 06-backlog.md.

REVISED RECOMMENDATION (mine, pending owner ruling on #5): ship name + id only
for beta.205. That closes the actual gap the task exists for -- a resolvable
from_id on role="character" lines -- carries no privacy question, and costs
almost nothing per turn. Qwen independently reached the same floor: "if the
only goal is resolving from_id, the safest possible entry is name + id."
A richer blurb needs an owner-authored public-facing field (new column +
dashboard), which is its own slice, not a characterInfo reuse.

## OWNER RULINGS 2026-08-18 (settled -- do not re-litigate)

RULING 1 -- privacy: a GENERATED third-person blurb counts as NON-disclosure.
The summary renders for every character regardless of `definitionPublic`.
Rationale accepted: the character is actively speaking in the channel, so its
voice, manner and premise are already on display to everyone present; a short
third-person blurb reveals far less than the card does (no system prompt, no
conversational examples, no dislikes list). Gating on `definitionPublic` was
rejected because that flag defaults FALSE, which would leave the feature off
for nearly every character.

RULING 2 -- generation: do NOT reuse `characterInfo` verbatim. A summarizer
generates the blurb automatically, so it is never owner-curated. Keyed off a
CHECKSUM of the character card; regenerate only when the checksum changes.

RULING 3 -- length: target parity with user personas, i.e. the same cap
(`DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH` = 4000, which is what persona
`content` uses -- persona.ts:239). Parity is on the CAP and its governance,
not a target length; real summaries land well under it. Build the bound as a
tunable constant, never hardcode 4000, so it can be dialled down if bleed
reappears.

Why parity is affordable here when raw card text would not be: the documented
bleed's MECHANISM was first-person "I" statements across a long span. A
third-person summary removes the mechanism rather than merely the volume. The
roster also sits in the cacheable S1 prefix and is byte-stable turn to turn,
so the marginal token cost is a cache hit rather than a fresh per-turn payment.

## SLICE PLAN

Scope is no longer size:M -- migration + job + summarizer prompt + roster work
is multi-PR. Split so the actual gap ships first and independently:

SLICE A -- roster + from_id, names only. Emit `from_id` on role="character"
lines; add sibling entries to <participants>; exclude the currently-speaking
character; update the instruction/notes wording. No migration, no summarizer,
no privacy surface. This closes the gap the task exists for and is shippable
alone.

SLICE B -- summarizer + checksum + blurb. Columns on `personalities`
(summary + source hash); checksum over the card fields the `definitionPublic`
doc comment already enumerates (characterInfo, traits, tone/age/appearance/
likes/dislikes, goals/examples); generation OFF the blocking path (enqueue on
mismatch, fall back to name-only for that turn -- same degrade-gracefully
shape as the forwarded-origin backfill in #2141). Precedent to copy rather
than invent: `UserFeedback.contentHash` is sha-256 hex in VarChar(64), with
`contentHash()` in ai-worker's `utils/duplicateDetection.ts`.

MARKUP (settled from the council pass + code corrections above): a
structurally distinct element for siblings, ONE shared id space, third-person
declarative prose, per-entry in-band name-first frame, provenance attribute
that is not `source="user_input"`. Element naming must avoid BOTH
`<character_info>` and `<character>` -- each already denotes the SELF card
(PersonalityFieldsFormatter.ts:108 and system_identity respectively).
`<peer_info>` was the only council proposal colliding with nothing.

NOT YET VERIFIED: how much of `FactExtractionService` is genuinely reusable
versus same-shape-different-code. Read it before claiming reuse in slice B.
<!-- SECTION:DESCRIPTION:END -->
