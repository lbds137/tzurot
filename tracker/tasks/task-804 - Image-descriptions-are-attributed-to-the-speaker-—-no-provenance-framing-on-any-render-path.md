---
id: TASK-804
title: >-
  Image descriptions are attributed to the speaker — no provenance framing on
  any render path
status: Done
assignee: []
created_date: '2026-08-28 23:59'
updated_date: '2026-09-20 13:00'
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

REOPENED 2026-09-19 — the clause-(b) watch FIRED. Prod recurrence on beta.226, request 0d4f851a-2b6b-496a-9117-ae2d64c3906a: Emily read a vision description as Lila's own prose. The assembled prompt's final user turn was `<from ...>Lila</from>` / "ugh, reddit embeds not working huh" / the raw description, with ZERO bracket headers anywhere in the message (regex `\[(Image|Sticker|Link preview|File|Voice message)[^\]]*\]` over the whole content returned no matches).

Diagnosis of WHY the shipped constraint did not bite: it names two surface forms the model can key on — the `<image_descriptions>` tag and the `"[Image: name]"` bracket header — and the trigger path emits NEITHER. `PromptBuilder.ts` builds the current message with `extractContentDescriptions` (bare `a.description`, joined) instead of `buildAttachmentDescriptions` (the one that emits `[Image: ...]` / `[Sticker: ...]` / `[Link preview: ...]` / `[File: ...]` headers and the `<voice_transcripts>` wrapper). So the constraint shipped keyed on a marker one of its three paths never produces. Introduced 6cdf58fe37 (2026-01-22), eight months pre-dating the constraint.

The fix is NOT the retired wrap — bracket headers carry no angle brackets, so the PROTECTED_TAGS/escapeXmlContent analysis above does not apply to them. It is: point the trigger path at `buildAttachmentDescriptions`, port `extractContentDescriptions`' BARE_PLACEHOLDERS filter into it so a totally-failed attachment does not render as `[Image: foo]\n[image]`, and DELETE `countAttachmentTokens` (the first draft said "align TokenCounters to count what actually ships"; PR #2456 review round 1 established it has no production caller at all — definition, a PromptBuilder wrapper, and tests only — so it and the wrapper were removed instead of aligned). `SearchQueryBuilder` keeps the bare form — memory search wants semantic text, not display headers.

Also surfaced by that review round and fixed in the same PR: attachment names reach a bracket-delimited provenance header unsanitized (`attachmentExtractor.ts` passes `name: attachment.name` straight from Discord, and `escapeXmlContent` only rewrites angle brackets for protected tags), so a filename carrying `]` could close the real header and forge a second one. `stripHeaderBrackets` in `RAGUtils.ts` now sanitizes the name at all THREE header sites — Image, File, and `buildAudioAttachmentHeader` — the last of which the reviewer did not name. Left deliberately unchanged: `buildImageDescriptionMap`'s `filename: att.metadata.name`, which renders as an XML attribute through `escapeXml` rather than into a bracket header. The CARE note above returns to live, but NARROWER than first written — correcting a premise this task carried for one commit: `contentForStorage` IS the built string, so its shape changes, but the conversation-history ROW already carried the headers independently. `VisionDescriptionWriter.persistTriggerDescriptions` upgrades the trigger row post-vision to `message + '\n\n' + buildAttachmentDescriptions(...)` (grep `enrichedContent` in `services/ai-worker/src/services/context/visionDescriptionWriter.ts`), so the cross-channel render has been reading bracket headers all along. What actually changes is the LTM/memory copy and the pre-upgrade window before that writer lands. The earlier claim that the cross-channel render was part of the blast radius was wrong.

Acceptance clause 3 (no double-render) therefore holds and is UNCHANGED by the PromptBuilder fix, but is established by code-reading only, not by a test: the row's content carries the header while `messageMetadata.imageDescriptions` is injected per-job in memory by `injectImageDescriptions` and never persisted, so a DB-sourced cross-channel row renders the header once and no `<image_descriptions>` block; the main chat_log takes its content from a live Discord fetch rather than the stored row, so it renders the injected block once and no header. Neither path renders both. Pinning that with a test is what clause 3 still wants.

CLOSED 2026-09-20 — PR #2456 merged (`86768cb47`). The emitter gap is fixed: the trigger path now renders through `buildAttachmentDescriptions`, so the `[Image: ...]` header the shipped constraint keys on actually reaches the model on the path that lacked it. Clause 2 was already met. Clause 1 stays UNVERIFIED by construction and by the owner's 2026-08-29 waiver — no test can show a prompt constraint is obeyed, and that limit is unchanged.

Clause 3 (no double-render) is closed as correct-as-is rather than tested. Review round 2 of that PR confirmed it structurally and independently, from the opposite end of the seam to the argument above: `DependencyStep` hands `VisionDescriptionWriter.persistTriggerDescriptions` the raw `job.data.message` placeholder field, never `budgetResult.contentForStorage`, so the two writers cannot collide because they are fed different inputs. That is a stronger reason than the situational one this task originally recorded. It remains untested; if a regression test is wanted it belongs with the TASK-841 hoist, which reopens the same seam.

The PR also closed two forgery vectors the header's new load-bearing status created — `headerDisplayName` for the attachment NAME, `neutralizeHeaderMarkers` for the description BODY, at all three emitting sites, with `HEADER_LABELS` as the single list both read and a set-equality test against it. The sibling gap that sweep missed is TASK-1025.
<!-- SECTION:DESCRIPTION:END -->
