---
id: TASK-660
title: 'Character roster blurb: summarizer + card checksum (TASK-657 slice B)'
status: Done
assignee: []
created_date: '2026-08-18 19:04'
updated_date: '2026-08-19 18:41'
labels:
  - 'area:ai-worker'
  - 'size:L'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 660000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice B of TASK-657. Slice A shipped the roster and from_id binding (names only); this adds the generated third-person blurb inside the character_participant element.

Owner rulings already settled in TASK-657 -- do not re-litigate:
- Privacy: a GENERATED third-person blurb is NON-disclosure. It renders for every character regardless of definitionPublic (which defaults FALSE, so gating on it would leave the feature off for nearly every character).
- Generation: do NOT reuse characterInfo verbatim. ShapesPersonalityMapper.ts:186 sets characterInfo from config.user_prompt, so imported characters carry instruction-register text in that field. A summarizer produces the blurb; it is never owner-curated.
- Length: parity with user personas on the CAP (DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH = 4000, what persona content uses per persona.ts:239) and its governance, not a target length. Build the bound as a tunable constant, never hardcode 4000, so it can be dialled down if bleed reappears.

Fix shape:
- Columns on personalities: the generated summary plus a source hash. Precedent to copy rather than invent -- UserFeedback.contentHash is sha-256 hex in VarChar(64), with contentHash() in services/ai-worker/src/utils/duplicateDetection.ts:276.
- Checksum over the card fields the definitionPublic doc comment enumerates (characterInfo, traits, tone/age/appearance/likes/dislikes, goals/examples). Regenerate only on mismatch.
- Generation runs OFF the blocking path: enqueue on mismatch and fall back to name-only for that turn -- same degrade-gracefully shape as the forwarded-origin backfill in PR #2141.
- Render the blurb inside character_participant. Settled markup: third-person declarative prose, per-entry IN-BAND name-first frame (block-level framing alone is the mechanism that already failed the identity-bleed incident), and a provenance attribute that is NOT source="user_input" (siblings are system-authored). Slice A deliberately shipped no in-band frame because there is no prose yet; it lands here.

VERIFIED 2026-08-18 -- FactExtractionService is NOT reusable, and the earlier
"leverage the fact summarization mechanism in modified form" framing should not
survive into the build. It is 477 lines of episode batching, per-persona
grouping, supersession scoring, FactStore writes and embeddings; none of that
applies to summarizing ONE character card. What is genuinely shared is the
general machinery it happens to use, which any new model-calling job would use
directly rather than inherit:
- createChatModel (ModelFactory)
- ExtractionBudget consume/refund, including the zero-spend-is-counter-neutral rule
- extractJsonPayload + a Zod-validated response schema (extractionPrompt.ts)
- the fail-to-skip posture and the write-usage-past-the-point-of-no-return rule
Treat those four as the reuse surface. Expect no discount on the job itself.

SIZE, from that read: 3-4 PRs. Migration (2 columns) and the checksum are small;
the summarizer job is the bulk (new BullMQ job type + handler + prompt + schema +
budget + usage logging), plus a backfill for existing characters and a bleed
check on real generated blurbs.

STANDING OWNER INSTRUCTION 2026-08-18: "identify any code reuse / refactoring
opportunities along the way." Applies to every slice-B PR, not just the first.
Report them as found rather than batching to the end.

Carried from the #2143 review: character_participant is ALREADY in PROTECTED_TAGS (packages/common-types/src/utils/promptSanitizer.ts), added by slice A for parity with participant. It is currently inert -- slice A routes the name and id through the strict escapeXml, which needs no tag-boundary protection. When this slice puts generated prose inside the element and routes it through escapeXmlContent, the entry becomes load-bearing. Do NOT add a second entry for it.

Acceptance: editing a character card changes its checksum and enqueues a regeneration; the rendered roster entry carries a third-person blurb within the tunable cap; a turn racing an un-generated blurb renders name-only rather than blocking.

## PREMISE CHECK 2026-08-19 (read-only, before any code) — one stated precedent is wrong, one field list is the wrong source

Every factual claim in the fix shape above was checked against the code. Two
need correcting before PR 1, and both would have produced working-but-wrong
code rather than a visible failure.

1. THE CHECKSUM PRECEDENT CONFLATES TWO UNRELATED FUNCTIONS. The fix shape
says "UserFeedback.contentHash is sha-256 hex in VarChar(64), with
contentHash() in services/ai-worker/src/utils/duplicateDetection.ts:276" as
though those are one thing. They are not connected at all:

   - duplicateDetection.ts contentHash() TRUNCATES: it returns
     `.digest('hex').substring(0, 16)` — 16 chars, never persisted to any
     column, and it lowercases its input.
   - user_feedback.content_hash is written by hashFeedbackContent
     (packages/common-types/src/utils/feedbackNormalization.ts:22), which
     emits the FULL 64-hex digest. Producer verified by grep, not inferred:
     services/api-gateway/src/routes/user/feedback.ts:108 is the only writer.

   The codebase already documents this exact trap — hashFeedbackContent's own
   docstring reads "the repo's other sha-256 helpers all truncate; this one
   must not" — and cacheObservability.ts:30 carries a "Deliberately not
   duplicateDetection.ts's contentHash" note. Copying the named function into
   a VarChar(64) column would store a 16-char value in a 64-wide column and
   throw away collision resistance for nothing.

   Additionally, contentHash() LOWERCASES. For a card checksum that is a
   behaviour change, not a normalization: a case-only edit to a bio would not
   change the hash and would never regenerate the blurb. Decide the
   normalization deliberately; do not inherit it.

   Use hashFeedbackContent as the shape precedent (full digest, one shared
   implementation, normalization chosen on purpose) — NOT contentHash().

2. THE definitionPublic DOC COMMENT IS THE WRONG SOURCE FOR THE CHECKSUM SET,
and the fix shape also transcribes it incompletely. The comment
(prisma/schema.prisma:430-436) enumerates characterInfo, personalityTraits,
tone/age/appearance/likes/dislikes, conversational goals/examples, AND
errorMessage AND customFields. The fix shape's parenthetical drops the last
two.

   But the deeper issue is that the list is the wrong one to copy. That comment
   describes what REDACTION hides from non-owners — a privacy boundary. The
   checksum answers a different question: what makes the generated blurb STALE.
   Those sets are not the same, and the cost of conflating them is real money:
   a field in the checksum that the summarizer never reads (errorMessage is the
   character's custom failure text; it cannot appear in a third-person blurb)
   burns a model call on every edit to it.

   The clearest demonstration that the privacy list is the wrong source: it
   does not contain `name` or `displayName` at all (they are not redactable —
   the roster renders them openly). But a third-person blurb that NAMES the
   character goes stale the moment it is renamed, and a checksum derived from
   the redaction list would miss that entirely. The opposite error to the
   errorMessage one, from the same conflation.

   For reference, the card fields actually available (prisma/schema.prisma,
   model Personality): characterInfo and personalityTraits (both required),
   personalityTone/Age/Appearance/Likes/Dislikes, conversationalGoals,
   conversationalExamples, customFields, errorMessage, birthMonth/Day/Year,
   plus name/displayName. Which of those the prompt consumes is a judgement
   call to make once, in PR 2, with the reason recorded — conversationalExamples
   in particular is a real question, since feeding verbatim example dialogue to
   a summarizer invites the blurb to quote it.

   The checksum set should be exactly the summarizer's INPUT set — the fields
   the prompt actually consumes — decided when the prompt is written in PR 2,
   and the two must be defined together so they cannot drift. If PR 1 lands the
   column first, its comment should say the set is provisional until the prompt
   exists.

VERIFIED AND CORRECT, so do not re-check: character_participant IS already in
PROTECTED_TAGS (packages/common-types/src/utils/promptSanitizer.ts:89), and
DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH is what persona content is bounded by.
Path correction only: that bound lives at
packages/common-types/src/schemas/api/persona.ts:239, not under types/schemas/.

## PR 1 landed (#2148) — note carried forward for PR 2

hashCharacterCard accepts `string | null | undefined` only. birthMonth/Day/Year
are `Int?` on the model, so if any of them enters the summarizer's input set the
call site must convert explicitly — there is no implicit numeric coercion and
the compiler will say so. Raised by the PR 1 review; no fix needed in PR 1
because no caller existed yet.

A fully-empty card hashes to the sha-256 of the EMPTY STRING, shared by every
other fully-empty card (pinned by a test). PR 2's caller must therefore detect
"nothing to summarize" by testing for that specific digest, never by comparing
two cards' checksums to each other — and should skip enqueueing a model call
entirely in that state rather than paying for a blurb about nothing.

PR 2 should CONSTRAIN THE KEY TYPE when the real caller lands — a literal
union of the field names, not a runtime guard. Reviewer's point, and it is the
better of the two: the field set is fixed and known at that moment, so the
compiler can enforce what a runtime assert would only detect, and it costs
nothing while there is still no caller. Falling back to a runtime guard is the
second choice. Either way the property to protect is:
hashCharacterCard's entry-boundary uniqueness assumes keys carry no `:` and no
newline, and keys are NOT normalized on the way in the way values are. A doc
comment is the only thing holding that today, and this hash gates whether a paid
model call fires — so a future key-list refactor should fail loudly rather than
silently degrade collision resistance.

Zero-width characters are deliberately NOT stripped by normalizeCardField,
and the reviewer's suggestion to add them was declined on merit rather than
deferred. U+200D (zero-width joiner) is semantically load-bearing — it binds
emoji sequences and is a real letter-joining control in several scripts — so
stripping the zero-width range would CHANGE content rather than normalize it,
in a character set a character card is quite likely to contain. The cost of
not stripping is one wasted regeneration if someone pastes a stray U+200B;
the cost of stripping is silently corrupting an emoji or an Indic name. NFC
already covers the composition cases that actually recur.

Also settled in PR 1, so PR 2 inherits rather than re-decides: the checksum
preserves CASE (a rename is a real staleness event for a blurb that names its
character), normalizes to Unicode NFC, and collapses whitespace runs; null/undefined/empty/whitespace-only
are one absent state.

## PR #2149 landed the GENERATION half — what is settled, and what remains

The field set is decided and lives in
services/ai-worker/src/services/rosterBlurb/rosterBlurbPrompt.ts, which owns
BOTH the checksum's entry keys and the prompt's inputs so they cannot drift.
IN: name, displayName, characterInfo, personalityTraits, personalityTone,
personalityAge, personalityAppearance, personalityLikes, personalityDislikes,
conversationalGoals. OUT with reasons: conversationalExamples (verbatim
first-person dialogue invites quoting — removing the material beats prompting
against it), errorMessage (cannot appear in a description), customFields (no
register guarantee), birthMonth/Day/Year (personalityAge covers it in prose;
also Int? where the hash takes strings). Do not re-open this set without
re-reading the per-field drift test that pins it.

STALENESS IS DECIDED AT WRITE TIME (owner correction, 2026-08-19). Every write
path that can change a card stamps personalities.card_source_hash as part of
that change, and the sweep asks the database which blurbs are stale:
roster_blurb_source_hash IS DISTINCT FROM card_source_hash. Nothing rehashes a
card to discover that it changed, and nothing hashes on the request path.

An earlier revision had the sweep DISCOVER staleness by rehashing a page of
candidates ordered by updatedAt. That was wrong beyond the wasted work: the
page was a fixed 200 rows used as a proxy for "recently edited", so a character
edited before 200 other rows moved would fall off it and never regenerate.

Stamping is derived from the row the write RETURNED, inside the same
transaction -- NOT from merging the patch by hand, which would mean re-deriving
each route's field precedence (the user update route sets displayName from name
when the client omits it) and would fail silently by stamping a digest no
generation can match. stampCardSourceHash's parameter type demands every card
field, so a select missing one is a compile error.

The five stamping sites: admin create + update, user create + update,
ShapesImportHelpers.upsertPersonality. Each has a colocated seam test. A sixth
site added later without a stamp would leave those characters' blurbs
permanently stale -- that is the known soft spot, and no guard covers it yet.

Generation still runs on the scheduled sweep rather than at the edit, so
api-gateway needs no coupling to ai-worker's job wiring and a dropped or failed
generation self-heals next tick. Per-tick spend is bounded by the stale query's
own LIMIT.

Pre-existing rows carry no stamp, and NULL IS DISTINCT FROM NULL is false, so a
transitional stamping pass fills them in once and then returns nothing forever.

Blurb writes go through prisma.$executeRaw, NOT update(): personalities is
sync-tracked and dev<->prod reconciles last-write-wins on updated_at
(03-database.md), so a client-level write would let a generated blurb win the
next sync over a genuine card edit made in the other environment. Consequence
accepted: blurbs do not propagate across environments; each env's sweep
generates its own.

REUSE landed alongside (standing owner instruction): invokeExtractionModel's
provider routing and client construction moved to
services/ai-worker/src/services/systemModel/systemModelCall.ts. Timeout and
OpenRouter attribution suffix stay per-caller. Fact extraction keeps its own
entry point; its provider tests moved with the code.

STILL OPEN — the RENDER half, which is what keeps this task alive. PR #2149
shipped generation; nothing reads rosterBlurb yet.

GROUNDING DONE 2026-08-19, so the render PR starts from these rather than
rediscovering them:

- FETCH IN ContextStep, NOT at render. PromptBuilder is a pure formatter
  (constructed `new PromptBuilder()`, no Prisma anywhere), and
  extractCharacterParticipants builds the roster from history rows that carry no
  personality data. More decisively, the roster renders TWICE — once in
  ContentBudgetManager's pre-pass measurement and once in the shipped prompt —
  and that file already documents why the responder identity is built once
  rather than twice ("the budget identity holds only if the two see identical
  inputs"). A fetch at render time would run twice and any drift would corrupt
  the token budget. ContextStep is where PreparedContext.rawConversationHistory
  is already populated and where Prisma is available.
- THREE read states, not two. An empty STRING means "generated, nothing to say"
  (a blank card, stored deliberately so the sweep stops re-examining it). `'' !=
  null` is true in JS, so guarding on null alone renders an empty description.
  Treat null and '' alike: name-only. The schema comment now says this.
- Sequencing test required: this is the shared-mutable-context seam from
  02-code-standards (a pipeline step writing a field a later step reads), so ONE
  test must run the steps in order. Avoid the `?? []` write-back shape the
  existing `context.rawConversationHistory ?? []` reads use — it erases the
  absent-vs-empty distinction "no blurbs yet" depends on.
- No cache on the first cut. One fetch per turn over at most
  MAX_ROSTER_CHARACTERS ids; adding a TTL cache before there is evidence it is
  hot is the speculative-index mistake in a different costume.
- Still to build: the per-entry IN-BAND name-first frame inside
  character_participant (block-level framing alone is what failed the
  identity-bleed incident), a provenance attribute that is NOT
  source="user_input", routing the prose through escapeXmlContent (the moment
  character_participant's PROTECTED_TAGS entry stops being inert), and a real
  assertion that a turn racing an ungenerated blurb renders name-only rather
  than blocking — that acceptance clause is only trivially true while nothing
  renders.

CARRIED NIT from the #2149 round-10 review, to fold into the render PR: the
sweep's "does nothing at all when the runtime switch is off" test asserts
queryRaw and the model invoker are not called, but not $executeRaw /
personality.findMany — so it does not pin that stampMissingHashes is skipped.
Two assertions; not a live bug, the enabled check does short-circuit first.

OWNER DECISION PENDING before the release: rosterBlurbEnabled ships false.
Turning it on is a corpus-wide spend event (bounded, but it works through every
character). Recommend flipping it in dev first, after the render half lands, so
real generated blurbs can be read before prod.

## DONE — the render half shipped in #2150 (2026-08-19)

Acceptance re-read at close, per clause:
- "editing a character card changes its checksum and enqueues a regeneration" —
  MET by #2149, with the wording corrected rather than glossed: it landed as
  write-time stamping plus a scheduled sweep, not an enqueue. Five write paths
  stamp card_source_hash; the sweep selects on
  roster_blurb_source_hash IS DISTINCT FROM card_source_hash.
- "the rendered roster entry carries a third-person blurb within the tunable
  cap" — MET. The cap is enforced at generation (fail-to-skip past it).
- "a turn racing an un-generated blurb renders name-only rather than blocking" —
  MET, and only genuinely testable now that something renders. Asserted on the
  formatter AND end-to-end through the real chain in rosterBlurbSeam.test.ts.

Six review rounds. Round 1 found a second copy of the flag description I had
claimed to fix; round 2 found the job-chain contract test's "exactly the
production wiring" comment falsified by the new constructor arg (fixed
structurally — both callers now build through contextStepFactory); rounds 4-6
each found the PREVIOUS round's fix incomplete in the same shape, ending in a
blank-name class that MY OWN TASK-644 trim had introduced on both the persona
and character sides.

STILL OPEN, and deliberately not part of this task:
- TASK-684 — staleness keys on the card alone, so a prompt/cap/model change
  never regenerates. Filed from a round-1 Info finding.
- TASK-683 — the history-row shape drift PromptHistorySource exposed.
- The FLAG FLIP is an owner decision and a release action, not task work. Two
  things to watch when it happens, from the round-6 review: fetchCharacterBlurbs
  adds one awaited PK lookup to the generation path, and
  extractCharacterParticipants goes to 3x per turn. Both are bounded and both
  are inert at rosterBlurbEnabled=false; check generation-latency after the
  flip rather than before.
- TASK-651 is COUPLED to the flip, found while grounding it: humans render
  before characters in the participants block, so the guild_info flicker
  diverges the prefix UPSTREAM of every blurb byte. Turning blurbs on without
  651 makes each S1 miss more expensive. 651 need not precede the CUT; it must
  precede the flag going on in PROD.
<!-- SECTION:DESCRIPTION:END -->
