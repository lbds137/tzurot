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

## CONVERGE TOWARD THE STORED PATH, NOT AWAY FROM IT

The framing above (and the council's) implicitly treats the two renderers as
peers to be merged. Reading `xmlMetadataFormatters.formatStoredReferencedMessage`
end to end says otherwise: **the stored full path is already very close to the
canonical `renderReference` this task wants**, and the live path is the outlier.

Concretely, the stored path already does three things the live path does not:

1. **Forwarded is a MODE, not a separate function.** It renders forwarding as
   `type: ref.isForwarded ? 'forward' : undefined` on the one renderer. The live
   path has a whole separate `formatForwardedReference` method that duplicates
   the timestamp/attachment/embeds handling of `formatStandardReference`. Kimi's
   `renderReference(ref, mode)` shape is *already implemented* on the stored
   side; the live side is what has to give.
2. **Media splitting is correct and per-attachment.** `splitStoredMedia` emits a
   description OR a marker per image, never both and never neither. The live
   path has no equivalent — its deduped branch carries descriptions while its
   own content string separately carries markers for the same image, an overlap
   its comment admits is intentional-for-now.
3. **Persona hydration** (`resolvedPersonaName` / `resolvedPersonaId` →
   `from` / `from_id`) has no live counterpart at all.

So the migration direction flips: lift `formatStoredReferencedMessage`'s shape
into the shared `renderReference`, then make the LIVE path produce a
`ResolvedReference` that feeds it — rather than treating the live formatter as
the base and teaching it about stored rows.

**Two more divergences the union must decide, both model-visible:**

- **`number`.** `[Reference N]` numbering is live-only (`StoredReferencedMessage`
  has no `referenceNumber`); the stored path renders quotes unnumbered. Either
  the stored path starts numbering positionally or the attribute stays
  conditional — this is a prompt-shape decision, so it belongs with the owner's
  vocabulary call rather than being settled silently by whichever branch the
  refactor happens to write first.
- **`username`.** The live deduped stub passes it; the stored deduped branch does
  not. Same quote, one attribute apart.

**bot-client's stub deletion — VERIFIED dead, and here is the chain**, because
the obvious read says otherwise and the next person will hit the same scare.
`ReferenceFormatter.appendDedupedStub` pushes the stub into `s.references`,
which reaches `ConversationPersistence`, whose line ~271 writes
`referencedMessages: convertToStoredReferences(referencedMessages)` — a DB
write, not a log line. That looks like the stub being persisted.

It is not reachable. `PersonalityChatManager` calls `saveUserMessage` WITHOUT a
`referencedMessages` argument (the arg was removed as a no-op — the thin
envelope never carries that field), so the optional param is undefined and the
`if (referencedMessages && ...)` guard never opens on the live path. The
enriched array's only live consumers are log lines. Stored reference rows come
from `DiscordChannelFetcher` instead — a different path entirely.

So the deletion is safe. Trace the guard, not just the write.

## SETTLED DESIGN — third council pass (GLM 5.2 · Kimi K3 · Qwen 3.7 Max)

Re-councilled because the two earlier passes ran on a premise the grounding
above disproved (four paths, two peer renderers, live-as-base). Owner delegated
the vocabulary call with one constraint: _"I don't care that much as long as
it's consistent."_ That constraint is what decides it — the inconsistency worth
fixing turned out not to be live-vs-stored at all.

### The real inconsistency

An image renders under `<image_descriptions>` when the vision call SUCCEEDED and
under `<attachments>` when it did not. The same object, two unrelated tag names,
selected by whether an API call worked. Voice has the same split. And the two
container names are in different registers: `<image_descriptions>` /
`<voice_transcripts>` name the DERIVED ARTIFACT, `<attachments>` names the
SOURCE OBJECT.

### The vocabulary (3/3 agreed on the shape; specifics synthesized)

```xml
<attachments>
  <image filename="cat.png">a cat asleep on a keyboard</image>
  <image filename="unlucky.png" status="undescribed"/>
  <voice filename="audio.ogg">hey, can you hear me</voice>
  <file filename="report.pdf"/>
</attachments>
```

`<image_descriptions>` and `<voice_transcripts>` are **deleted**. Everything
names the source object; enrichment is the element's text content.

Per choice, and why it beat the alternative:

- **Per-modality tags over `<attachment type="image">`** (GLM over Qwen):
  `<image ` is both cheaper and more readable than `<attachment type="image" `.
- **Enrichment as text content over a `<description>` child** (Qwen over GLM):
  flatter, and it is the form ALREADY in production
  (`<image filename="X">desc</image>`), so it ships pre-tested.
- **Keep the `<attachments>` wrapper** (GLM over Qwen): matches `<embeds>`, and
  `addArraySection` already emits wrapped sections.
- **`status` when enrichment is absent** (GLM's unasked-for find): silently
  omitting the description leaves the model unable to distinguish "failed" from
  "still processing" from "nothing worth describing", so it hallucinates one or
  apologises for a missing one. Stated explicitly, it can say the true thing.

**`status` value space is designed for TASK-367 now, not retrofitted**:
`undescribed` · `untranscribed` · `expired`. The owner's locked retention
decision (an aged-out image renders a content-free presence note) guarantees a
second cause for "no description", so a boolean `failed` would need migrating
the moment 367 lands.

**Filename is signal, not just an identifier — owner call.** Sometimes the name
carries the clue (`error-screenshot-checkout.png`). It is therefore carried in
BOTH arms, and it matters most on the undescribed arm where it is the only
signal left. Corollary: **omit the attribute entirely when there is no real
name** — never synthesize a placeholder. Today two paths invent different ones
(`?? 'image'` and `?? 'attachment'`), and `splitStoredMedia` matches
described-vs-undescribed BY filename, so the two fallbacks disagreeing renders a
nameless image twice. One element per attachment removes the correspondence
lookup, and that whole bug class with it.

**Emit `username` only when it differs from the display name** (Qwen). Resolves
the open live-vs-stored `username` divergence on a principle rather than a coin
flip, and costs fewer tokens.

### Type names — 3/3, independently

`RenderableReference` / `RenderableAttachment`; constructors `fromLiveReference`
/ `fromStoredReference`. All three rejected `Resolved`: it already means
persona-hydrated in this codebase (`resolvedPersonaName`,
`resolvedImageDescriptions`), and overloading it would collide.

Membership rule (GLM, sharpened by Kimi): a field belongs on the canonical type
**iff the emitter draws it** — the criterion is drawn-ness, NOT divergence. That
dissolves most of the live/stored field split, because `discordUserId`,
`authorDiscordId`, `webhookId`, `authorIsBot` and `discordMessageId` all drive
UPSTREAM dedup/role decisions and never reach the renderer (verified by grep).
`referenceNumber` is the one live-only field that IS drawn, so it stays.
`from`/`fromId` enter **pre-resolved** so `resolvedPersona*` never enters either.

### Design corrections to this task's own recorded shape (Kimi K3)

1. **There is no `mode` param.** This task recorded
   `renderReference(ref, mode: 'full' | 'deduped')`. Wrong on both halves:
   `isForwarded` is a FIELD, so passing it as a mode creates a second source of
   truth that can disagree with the ref; and dedup is the PROJECTION already
   agreed above, not a mode. End state: **1 renderer, 2 adapters, 1 projection
   helper, 0 mode params.** `renderReference(ref)` reads `ref.isForwarded`;
   deduped is `renderReference({...ref, content: STUB_MARKER})`.
2. **Deleting the string return type is necessary but insufficient — delete the
   `attachmentLines: string[]` SLOT from `formatQuoteElement`'s options.** While
   the slot exists, the next caller fills it and the divergence regenerates. The
   slot is the affordance.
3. **Keep hydration out of the renderer.** Adapters resolve identity; the
   renderer stays pure.

### Sequencing — two PRs (Kimi; council split 3 ways, this is the synthesis)

All three agree the `processAttachmentsParallel` return-type change cannot be
staged AFTER the collapse — pre-rendered strings cannot be un-parsed. They split
on whether the model-visible flip rides along: GLM said one PR, Qwen said decide
first then one PR, Kimi said two.

**Taking Kimi's**: PR-1 collapses the render paths and must be **output-
identical** — snapshot every path's XML before and after and prove byte-equality.
PR-2 is the vocabulary flip: a small, independently revertible diff with a clean
prompt delta. That makes the refactor provably behaviour-preserving and gives the
model-visible change its own revert handle.

Bundle into PR-2 (same class, same decision): the vocabulary flip, `username`
conditionality, and **live persona hydration** — Kimi's find: live does no
persona hydration at all, so the same persona's message renders a different
`from_id` live vs stored.

### Council claims REJECTED (verified against the code, not assumed)

- **"Rename `<quote>` to `<message>`"** (Qwen): would COLLIDE.
  `conversationUtils.ts:147` already emits `<message from=… role=… t=…>` for
  chat-log history; `<quote>` is used only inside `<contextual_references>` /
  `<quoted_messages>`. The distinction Qwen thought was missing is the one that
  already exists.
- **"XML injection is unhandled (critical)"** (Qwen): already handled —
  `escapeXml` on attributes, `escapeXmlContent` on text,
  `neutralizeWrapperClosingTags` on transcripts, all in `formatQuoteElement`.
- **Structured `<embed>` normalization** (Qwen): real, but out of scope here —
  `embedsXml` is pre-formatted by bot-client's EmbedParser. File separately if
  it is worth doing.

## SECOND GROUNDING PASS — the recorded sequencing is not buildable as written

Read the remaining consumers before starting PR-1 (`conversationUtils`,
`referenceEnricher`, `AttachmentProcessor`, the two schemas). Five corrections,
the last of which restructures the PRs. The DESIGN — one canonical type, two
adapters, one renderer, dedup as projection, unified attachment vocabulary — is
unchanged. What changes is what can ship in which PR.

**1. Six render paths, and the sixth is not a reference.** `conversationUtils.ts:131`
renders a forwarded HISTORY MESSAGE through `formatForwardedQuote`, filling all
four enrichment slots from `msg.messageMetadata`. It has no `ReferencedMessage`
anywhere in it, so it can never take a `RenderableReference` — it is a
legitimate second consumer of the shared emitter, not a member of the collapse.
Enumerate it anyway: it constrains what the emitter's interface may drop.

**2. The `attachmentLines` slot CANNOT be fully deleted.** That sixth path feeds
it from `messageMetadata.forwardedAttachmentLines` — a **persisted `string[]`**
(`schemas/message.ts:167`, produced at `DiscordChannelFetcher.ts:460` as
`[contentType: name]` markers). Pre-rendered strings already in the database
cannot be un-parsed, which is the same argument that forces the
`processAttachmentsParallel` change to come FIRST, now pointing the other way.
So the slot survives, narrowed and renamed to say so, until the producer emits
structured metadata and legacy rows are handled. Deleting the affordance is
still the goal; it is one migration away, not one refactor away.

**3. The dedup exclusion set is THREE members, not one.** This task recorded
"exactly ONE member (`content`) … the only one history provably carries."
False on the code: `formatDedupedQuote` also omits `locationContext` and
`embedsXml`, and its own docstring gives the reason — both are reproduced
verbatim in `<chat_log>`. A one-member projection would add every stub's embeds
back, which is the token cost dedup exists to avoid. Correct set:
`content → marker`, `locationContext`, `embedsXml`.

The safety property that motivated projection is untouched by this, and that is
the point worth keeping: what matters is **subtraction from the canonical render
rather than field-by-field reconstruction**, so a NEW field is inherited by
default. Whether the subtraction set has one member or three changes nothing
about that. "Exactly one" was rhetoric; it read as a design constraint.

**4. `buildDedupedReferenceStub` is NOT deletable — only bot-client's CALL is.**
The verified-dead chain recorded above is `ReferenceFormatter.ts:133`. The LIVE
caller is `referenceEnricher.ts:99` (ai-worker), which produces the very stubs
`formatReferencedMessages`'s `isDeduplicated` branch renders. An earlier note
here reads as though the function itself goes; it does not. Under the projection
its body collapses to flag-setting — the content-emptying, marker-folding and
capping move to the renderer's projection helper, where the full reference is
still in hand.

**5. "PR-1 must be output-identical" is unachievable, and the split inverts.**
Every element of the collapse changes output, so byte-equality cannot be the
acceptance test:

- the projection changes deduped output by construction (that is its purpose);
- one renderer reading `isForwarded` must pick ONE `from` rule, and the two
  paths disagree today (live forwarded hardcodes `from="Unknown"` and drops
  number/role/username/location; stored forwarded uses the ref's own author);
- the live and stored paths render the same attachment four different ways
  (`- Image (x): d` · `<image filename=…>d</image>` · `[image/png: x]` ·
  `- Image (x) [vision processing failed]`), selected by source AND by whether
  vision succeeded. One renderer + byte-equality ⇒ a mode param, which correction
  #1 of the third council pass already rejected on independent grounds.

So the vocabulary flip is not a rider that can follow the collapse — it is the
collapse's **prerequisite**, which is what the council was reaching for with
"the return-type change cannot be staged after." Corrected sequencing:

- **PR-1 — attachment vocabulary. ✅ SHIPPED (#1881, merged to develop).**
  `processAttachmentsParallel` returns `RenderableAttachment[]`;
  `formatQuoteElement` emits the settled `<attachments>` vocabulary with
  `status`; `imageDescriptions` / `voiceTranscripts` slots deleted;
  `attachmentLines` narrowed per #2. All six paths updated in place. Grew past
  its filing — see the close-out section at the end of this task.
- **PR-2 — the collapse. ✅ SHIPPED (#1882).** `RenderableReference`,
  `fromLiveReference` / `fromStoredReference`, `renderReference(ref)`, dedup as
  projection with the three-member exclusion set, `username` conditionality,
  bot-client's dead stub call deleted. Closed the absorbed follow-up (an
  undescribed attachment on a deduped ref) by construction. Live persona
  hydration split out — see PR-3 below. Close-out at the end of this task.
- **PR-3 — live persona hydration.** Recorded here as a rider on PR-2; split
  out during the build on MECHANISM, not effort. It is not a render change: it
  needs a Prisma client inside `ConversationInputProcessor` /
  `ReferencedMessageFormatter`, neither of which has one, plus a per-turn batch
  resolve (`batchResolveByDiscordIds`, as `storedReferenceHydrator` does — or a
  reuse of the participant resolution `MemoryRetriever` already performs, which
  is a real design question with a cost dimension). Bundling it would have added
  a service dependency and a new failure mode to a refactor whose acceptance
  test was an output changelist.

  It lands cleanly afterwards and cannot regenerate the divergence class: the
  canonical type already carries `from` / `fromId`, one renderer already draws
  them, and `fromLiveReference` is the only function that would change.

  _Problem_: live quotes render the Discord display name while `<chat_log>` and
  stored quotes render the persona name and bind `from_id` — the same person
  under two names in one prompt, with no ID binding on the live path.
  _Acceptance_: a persona's live-quoted message and its `<message>` line in the
  chat log carry the same `from` and the same `from_id`.

- **PR-4 — message-level alignment**, filed separately rather than assumed:
  `formatImageSection` / `formatVoiceSection` still emit `<image_descriptions>` /
  `<voice_transcripts>` at MESSAGE level. Leaving them recreates at the message
  level exactly the split PR-1 removes at the quote level, so consistency wants
  it — but it is the widest model-visible surface here (every history message,
  over persisted metadata), so it gets its own decision rather than riding along.

**Acceptance test, replacing byte-equality**: snapshot all six paths before, and
require the after-diff to contain ONLY an enumerated, written-down changelist.
Stronger than byte-equality, and unlike byte-equality it is actually satisfiable.

**Do NOT "fix" the missing `voiceTranscripts` on the stored deduped branch.**
Its comment is correct and worth preserving through the refactor: the live path
reads transcripts from in-memory preprocessing, and `StoredReferencedMessage`
has no audio counterpart to `resolvedImageDescriptions`. That is a schema gap
owned by TASK-367 (persist the built reference), not a dropped field here — and
a projection that "inherits every field by construction" must not paper over it
by emitting an empty section.

## PR-1 CLOSE-OUT (#1881) — what shipped, and what PR-2 inherits

Shipped beyond the filed scope, all of it the same class the task is about:

- **`RenderableAttachment` is a discriminated union.** `durationSeconds` cannot
  appear on an image, `description` cannot appear on a file, a status cannot
  name another modality's failure, and `description`/`status` cannot co-occur.
  Six `@ts-expect-error` assertions fail the build if any of that stops holding.
  PR-2 should extend the same treatment to `RenderableReference` rather than
  re-deriving invariants in prose.
- **`classifyAttachment` is single-sourced** (`QuoteFormatter.ts`). It closed a
  live/stored split introduced *while fixing that exact pattern*: the stored
  path also accepted any `audio/*`, so an ordinary music clip rendered `<file/>`
  live and `<voice status="untranscribed"/>` on replay.
- **`duration` rides every voice path.** A sweep of all five construction sites
  found two dropping it; only one had been reported. **Do the enumeration in
  PR-2 too** — patching the reported site is how the second one survived.
- **The estimator stopped being a second renderer** — `estimateReferenceLength`
  now calls `buildStoredAttachments` + `renderAttachment`, with a parity test.
  Closes two rows of TASK-370's drift table.
- **`ProcessedAttachmentResult.index`** deleted (threaded through three
  functions, never read).

**The lesson PR-2 should carry**: three separate findings in this PR resolved to
*delete the copy*, not *sync the copies* — the estimator's hand-written markup,
the test suite's hand-rolled mock renderer, and the duplicated classifier. Each
was three to six lines, which is exactly why none felt worth extracting until it
drifted. When PR-2 finds two things that must agree, the default answer is one
of them should not exist.

**Still true for PR-2**, unchanged by this PR: the six-path enumeration, the
persisted-`string[]` constraint on `legacyAttachmentLines` (#2 above), the
three-member dedup exclusion set (#3), `buildDedupedReferenceStub`'s live caller
(#4), and the accepted overlap where a live deduped stub renders a described
image twice — once as a marker folded into `content`, once structurally. That
last one closes by construction under the projection; it is the clearest single
proof that PR-2 is worth doing.
<!-- SECTION:DESCRIPTION:END -->

## PR-2 CLOSE-OUT (#1882) — what shipped, and what is left

**Acceptance was an enumerated changelist, not byte-equality** (the second
grounding pass proved the latter unachievable). All six paths were rendered
before and after against fixed fixtures and diffed; twelve differences, each
deliberate, are tabulated in #1882's body. Three were decisions PR-2 made that
the recorded design had not settled — the timestamp convergence, the
bot-preview narrowing, and the `username` rule — and were approved in plan mode
before the build.

Three more surfaced only from the actual before/after diff, which is the
argument for taking the snapshot first rather than reasoning about it:

- live deduped attachments were missing their `type` attribute (they were built
  from synthesized preprocessing metadata that omits content type);
- stored deduped quotes had lost `from_id`, so the model could not bind them to
  `<participants>` — one more field the stub's rebuild forgot;
- the deduped search text carried `[image/png: …]` marker noise into the
  embedding query, and dropped the reference's embed text.

**Shipped beyond the filed scope**, all the same class:

- `buildRenderableAttachments` — `buildStoredAttachments` and
  `splitPreprocessedEnrichment` were two copies of one algorithm differing only
  in correlation key. One kernel, one `describe` callback (inside the 2-callback
  ceiling), each caller keeping its own orphan-enrichment tail because an
  unmatched stored description and an unmatched `ProcessedAttachment` are
  genuinely different shapes.
- `formatTimestampWithDelta` deleted from `common-types` — the timestamp
  convergence left it with zero callers.
- `buildDedupedReferenceStub` and `capDedupText` left `common-types` entirely;
  the stub collapsed to `{...raw, isDeduplicated: true}` inline in
  `referenceEnricher`.
- The estimator's whole-`<quote>` parity, not just its attachments — it had
  invented `author=` and `location=` attributes the emitter never wrote, and a
  phantom ` forwarded="true"` where the emitter writes `type="forward"`. Pinned
  by exact equality. Closes the rest of TASK-370's reference-path drift row.

**The structural guard worth reusing**: `dedupeReference`'s test walks the
reference's OWN keys and asserts every non-subtracted one is inherited. A
field-by-field rebuild fails it the moment someone adds a field and forgets to
copy it — without anyone having to update a list. That is the shape to reach
for whenever "these two must agree" cannot be collapsed to one.

**Filed out of PR-2**: TASK-379 (bot-client's enriched `references` array is
dead work — it feeds two log counts while running Redis+DB transcript lookups
per reference). TASK-34's mechanism was restated: its `[contentType: name]`
markers no longer exist, but the unbounded per-attachment stub cost survives in
a new form and is the owner's call.
