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
<!-- SECTION:DESCRIPTION:END -->
