---
id: TASK-660
title: 'Character roster blurb: summarizer + card checksum (TASK-657 slice B)'
status: To Do
assignee: []
created_date: '2026-08-18 19:04'
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
<!-- SECTION:DESCRIPTION:END -->
