---
id: TASK-365
title: Reference rendering has FOUR hand-synced paths (live/stored x full/deduped)
status: To Do
assignee: []
created_date: '2026-07-30 23:08'
labels:
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 365000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Surfaced 2026-07-30 by the TASK-364 investigation. This is the root antipattern behind that bug and its predecessor.**

A quoted reference is rendered by two independent renderers — `ReferencedMessageFormatter` (live) and `xmlMetadataFormatters` (stored history) — each with a full branch and a deduped branch. Four code paths that must agree, kept in sync BY HAND.

`buildDedupedReferenceStub` (`packages/common-types/src/utils/referenceEnrichment.ts:189-205`) is the concrete smell: it rebuilds the reference field-by-field, so any field nobody remembered to list is silently lost. Line 199 hand-carries `authorRole` — that line IS the scar from the first bug of this class (TASK-162, quoted role dropped on the deduped path). TASK-364 is the second: `attachments` dropped the same way.

**Council 3/3 (GLM 5.2 / Kimi K3 / Qwen 3.7 Max) independently proposed the same fix:** make the deduped stub a PROJECTION of the full render rather than a parallel reconstruction. The stub becomes `fullRender with content := stubMarker`. The exclusion set has exactly ONE member (`content`) — the only field the token motive targets and the only one history provably carries. Future fields are inherited by construction; adding a second exclusion becomes a conspicuous, reviewable event instead of a silent omission.

Kimi K3: "Any fix that preserves the parallel builder preserves the class." Qwen: "you are testing two independent code paths for accidental convergence."

**Acceptance:** one extraction/render core; deduped is a projection; a new field on the reference model reaches both renderers without a per-field edit, or fails to compile.

## SECOND COUNCIL PASS 2026-07-30 (post-#1877) — verdict holds, scope sharpened

Re-councilled with the durable-store question attached (GLM 5.2 · Kimi K3 ·
Qwen 3.7 Max). **3/3 confirmed the projection verdict.** Two additions:

**The wire-payload objection is void — and bot-client's stub is dead weight.**
The envelope schema carries NO non-raw `referencedMessages` field
(`packages/common-types/src/types/schemas/rawEnvelope.ts`); only
`rawReferencedMessages`, full and un-stubbed. bot-client's
`buildDedupedReferenceStub` call (`ReferenceFormatter.ts:133`) feeds exactly two
log lines (`MessageContextBuilder.ts:399`, `gatewayServiceCalls.ts:245-246`) and
nothing else — never the model, never the DB, never the wire. So a projection
costs no payload, and **deleting bot-client's stub construction outright is part
of this task**. (An earlier framing of a wire-size cost was wrong and was fed to
one council member as a premise; Qwen challenged it independently.)

**Shape, per Kimi K3 (and compatible with Qwen's):** one canonical
`ResolvedReference` type; two constructors — `resolveLiveReference(raw,
preprocessed)` (this is #1877's splitter, relocated upstream) and
`resolveStoredReference(stored)`, each living next to its own data source; ONE
`renderReference(ref, mode: 'full' | 'deduped')` whose deduped arm is
`{...ref, content: STUB_MARKER}`. Satisfies the 2-callback ceiling without
needing its exception: plain per-source functions, no predicate params.

**Ordering vs TASK-367: this task goes FIRST.** Qwen argued persistence first
("otherwise the stored path is untestable") — that premise is false, stored rows
are constructed directly in `conversationUtils.test.ts` today. Kimi's reason
wins: persisting first would persist a shape this task is about to replace.

**OPEN, owner's call — vocabulary unification.** The live path renders images as
`attachmentLines` strings (`- Image (photo.png): …`), the stored path as
structured `imageDescriptions` (`<image filename="…">…</image>`): the same
reference renders DIFFERENT XML depending on path. Kimi + Qwen say unify here;
GLM says defer it as a separately-measurable change. It is the one piece with
model-visible impact, so it does not get decided by an agent.

**Absorbed follow-up (#1877 round-3 review):** the stored deduped branch
forwards `imageDescriptions` but no attachment markers, so a **stored, deduped**
attachment whose vision call FAILED renders with neither marker nor description
— invisible, same class as TASK-364. Confirmed pre-existing and not a regression
(the branch previously forwarded neither). Filed here rather than fixed in
#1877 because this task deletes the branch it lives in: once the stub is
`fullRender minus content`, the attachment renders exactly as the full path does
and the gap closes by construction. **Add it to the acceptance check**: a
deduped reference with an UNdescribed attachment must still name that attachment.

## GROUNDING PASS — three corrections from reading the code

Read end to end before building, per "principle from advisors, target from the
code". The verdict holds; three specifics in the framing above are wrong or
understated, and the third changes what the open owner question actually is.

**1. It is not four paths — the live renderer has THREE branches.**
`ReferencedMessageFormatter.formatReferencedMessages` dispatches deduped /
forwarded / standard. So the matrix is (live × {deduped, forwarded, standard}) ×
(stored × {full, deduped}) = five render paths, not four. `formatForwardedQuote`
is a thin wrapper over the same core, so it collapses for free — but it must be
in the enumeration or the sweep misses it.

**2. `formatQuoteElement` is ALREADY the one XML renderer.** Every path calls it
(`QuoteFormatter.ts`). The divergence is not two renderers emitting different
XML — it is which SLOT each caller fills:

| Path | fills | emits |
| --- | --- | --- |
| live standard + forwarded | `attachmentLines: string[]` | `<attachments>` |
| live deduped | `imageDescriptions` / `voiceTranscripts` | `<image_descriptions>`, `<voice_transcripts>` |
| stored (both) | `imageDescriptions` + attachment markers | `<image_descriptions>` + `<attachments>` |

So the "same reference renders different XML per path" split runs THROUGH the
live renderer, not just between live and stored — the deduped branch already
speaks the stored path's vocabulary while its own sibling branches do not.

**3. The vocabulary question has a concrete mechanical cause**, which makes the
owner's call narrower than "unify the XML". `processAttachmentsParallel`
(`AttachmentProcessor.ts:108`) returns `Promise<string[]>` — pre-RENDERED lines
(`- Image (photo.png): …`). A caller holding strings has no structured filename
or description left to place, so it can only fill `<attachments>`. The live
deduped branch escapes this precisely because `splitPreprocessedEnrichment`
gives it structured entries instead.

**The unification is therefore: make `processAttachmentsParallel` return
structured results and let the renderer format them** — not a change to the XML
emitter, which is already shared. The owner call stands (it is model-visible:
`<attachments>` lines become `<image_descriptions>` entries for the standard and
forwarded branches) but it is one upstream return-type change, not a rewrite of
the emitter.

**Type divergence the `ResolvedReference` union must absorb** — the two source
schemas (`packages/common-types/src/types/schemas/message.ts`) name the same
domain object with different fields, which is the drift underneath everything
above:

| | `ReferencedMessage` (live) | `StoredReferencedMessage` |
| --- | --- | --- |
| author identity | `discordUserId` | `authorDiscordId` |
| numbering | `referenceNumber` | positional |
| bot signals | `webhookId`, `authorIsBot` | — |
| dedup flag | `isDeduplicated` | — |
| persona | — | `resolvedPersonaId` / `resolvedPersonaName` |
| images | — | `resolvedImageDescriptions` |

Also confirmed by reading: `buildDedupedReferenceStub` drops `attachments` AND
`isForwarded` from its reconstruction — so a forwarded reference that also
dedupes loses its forwarded-ness silently. Third instance of the same class,
found without a bug report, and it closes by construction under the projection.
<!-- SECTION:DESCRIPTION:END -->
