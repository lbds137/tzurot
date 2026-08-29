---
id: TASK-804
title: >-
  Image descriptions are attributed to the speaker — no provenance framing on
  any render path
status: Done
assignee: []
created_date: '2026-08-28 23:59'
updated_date: '2026-08-29 14:24'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 804000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Characters read vision-model description prose as text the user wrote (prod evidence: request 623bb16a-f235-4dae-907a-81f9b69a954b, 2026-08-28 — Sera credits Lila with the vision model analysis: "identified the artist by signature, verified the halo-crown against the formal configuration"). The owner reports this recurring; prior fix task-361 (48bc5fdd7) fixed the GENERATION seam (which system prompt frames the shared cached description), never the PRESENTATION seam.

Mechanism: three render paths present machine prose with no provenance framing, while <facts> and <memory_archive> both carry explicit not-spoken-here <instruction> blocks:
1. Trigger message — services/ai-worker/src/services/RAGUtils.ts:50 extractContentDescriptions joins bare description prose onto the user text via buildMessageWithAttachments (services/ai-worker/src/services/prompt/MessageFormatters.ts:59) — no tags at all. Voice transcripts had this exact bug and were fixed by wrapping in <voice_transcripts> (comment at RAGUtils.ts:67); images never got the sibling fix.
2. History render — formatImageSection (services/ai-worker/src/jobs/utils/xmlMetadataFormatters.ts:214) renders <image_descriptions> inside the [Name - timestamp] speaker block, no provenance instruction anywhere in the prompt.
3. Quoted refs — QuoteFormatter <attachments> path, same gap.
The system prompt has only an engagement directive (protocol section, DB content) which encourages treating descriptions as conversation content.

Fix shape: (a) wrap trigger-path image descriptions in the same <image_descriptions><image filename=...> vocabulary the history render uses (sibling of the voice_transcripts fix); (b) add one provenance constraint to OUTPUT_CONSTRAINTS (services/ai-worker/src/services/prompt/HardcodedConstraints.ts:72, S0-cacheable, covers all paths): text inside image-description tags is an automated visual description of media the speaker shared - the speaker posted the image, not the prose. CARE: contentForStorage (PromptBuilder.ts:199) persists the built trigger message to history/LTM, so the wrap changes stored shape — check the dedup seam (live deduped quotes, 106afb33b) and escapeXmlContent PROTECTED_TAGS interaction before building.

Acceptance (AMENDED — the wrap half of the fix shape above is retired, see below): a character receiving an image (upload AND embed AND quoted ref) can distinguish the description from user-typed text; regression coverage pins the constraint text in both realMessagesEnabled states; no double-render of descriptions in history for uploaded images.

SHIPPED (constraint half): one provenance constraint in OUTPUT_CONSTRAINTS naming both surface forms (the <image_descriptions> tag and the "[Image: name]" bracket header), S0-cacheable so it reaches all three render paths and both flag states through the base constant. Pinned by 4 canaried assertions in HardcodedConstraints.test.ts. contentForStorage untouched, so the stored shape is byte-identical and the dedup seam is not in play (the CARE note above is therefore moot for this slice).

RETIRED (wrap half) — do NOT re-derive it: wrapping the trigger path in <image_descriptions> cannot work. Both image_descriptions and image are in PROTECTED_TAGS (packages/common-types/src/utils/promptSanitizer.ts:79-80), so a wrapper applied on the trigger path is escaped away by escapeXmlContent at PromptBuilder.ts:203 - the inverse of why voice_transcripts/transcript were deliberately left OUT of PROTECTED_TAGS so their wrapper survives. Reviving it requires either de-protecting tags that guard the history render containment, or a parallel unprotected image vocabulary; both were rejected. The asymmetry is pinned in both directions in packages/common-types/src/utils/promptSanitizer.test.ts.

REMAINING (why this task stayed open): (a) runtime smoke - a character receiving an image on each of upload / embed / quoted ref, confirming it no longer credits the sharer with the description's analysis. Prompt-level intervention, so model compliance is unverified by construction. (b) If prod after the constraint ships still shows mis-attribution, design the wrap slice with the escape ordering resolved first.

CLOSED 2026-08-29 — clause (a) WAIVED by owner, verbatim: "if we changed the prompt construction that's good enough for me tbh." The smoke was never going to be a proof (a prompt constraint cannot be shown compliant by three samples), and the owner accepts the constraint landing as sufficient. Recording the waiver rather than silently dropping it: what is being accepted is that model compliance stays UNVERIFIED, not that it was verified.

Clause (b) survives as a WATCH, not as open work: the trigger is a prod sighting of a character still crediting a sharer with description prose. The original report cites request 623bb16a-f235-4dae-907a-81f9b69a954b as the pre-fix specimen; a post-beta.210 recurrence is what would reopen the wrap slice, and the retired-wrap analysis above is the starting point for it.
<!-- SECTION:DESCRIPTION:END -->
