---
id: TASK-804
title: >-
  Image descriptions are attributed to the speaker — no provenance framing on
  any render path
status: To Do
assignee: []
created_date: '2026-08-28 23:59'
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

Acceptance: a character receiving an image (upload AND embed AND quoted ref) can distinguish the description from user-typed text; regression coverage pins the trigger-path wrap and the constraint text; no double-render of descriptions in history for uploaded images.
<!-- SECTION:DESCRIPTION:END -->
