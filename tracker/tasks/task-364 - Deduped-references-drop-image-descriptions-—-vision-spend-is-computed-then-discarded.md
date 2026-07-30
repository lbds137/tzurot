---
id: TASK-364
title: >-
  Deduped references drop image descriptions — vision spend is computed then
  discarded
status: To Do
assignee: []
created_date: '2026-07-30 22:35'
labels:
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 364000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Runtime-confirmed 2026-07-30 (prod, owner-reported).**

When a user posts an image/embed message WITHOUT triggering the bot, then replies to it to trigger, the reference's images are vision-described successfully — and the descriptions never reach the model.

**Evidence (prod ai-worker, 2026-07-30T22:24:47Z, job image-823aead4-...-ref1-image):**
- `Processing image description job ... imageCount=4`
- 4x `Invoking vision model ... qwen/qwen3.7-plus`
- `Image description completed ... processingTimeMs=47774 imageCount=4` (SUCCESS)
- `DependencyStep ... referencedAttachmentCount=4 totalPreprocessed=4` (available to the pipeline)
- Rendered prompt shows bare `[image/png: embed-image-1..4.png]` placeholders

**Mechanism (code-verified):** the deduped-reference branch passes only `content` and does no attachment processing — explicit code comment says so — in BOTH renderers (`ReferencedMessageFormatter` live path, `xmlMetadataFormatters` dedupedRefs.map stored path). `persistReferenceDescriptions` exists to prevent exactly this bare-marker symptom, but it writes `resolvedImageDescriptions`, which only the NON-deduped stored path reads.

The stub's premise — "full text in the chat log" — is FALSE for embed images: the chat-log copy renders raw `<embed><image url>` with no descriptions.

**Cost angle, the sharpest framing:** this is worse than not describing. We pay 4 vision calls and 47.8s of latency, then discard the result.

**NOT from beta.187:** dedup-skips-attachments is commit b1db45b06 (2026-02-15), an ancestor of v3.0.0-beta.186. #1872's MessageContentBuilder change is purely additive (appends stickerImages); the embed path is untouched.

**Same class as TASK-162** (role dropped on the deduped path, since fixed) — the deduped path keeps losing fields.

**Fix shape is a DESIGN CALL, owner-gated:** (a) thread descriptions into the deduped stub (costs tokens, but they are NOT duplicated since history lacks them); (b) make history carry embed-image descriptions so the stub premise becomes true; (c) do not dedup messages whose images are undescribed in history.
<!-- SECTION:DESCRIPTION:END -->

## COMPLETE DIAGNOSIS 2026-07-30 (owner supplied a working capture — regression CONFIRMED)

**Regression window pinned to the release.** Two `/inspect` captures of the same
workflow (post Reddit link → reply to own post → tag character), same day:

| | 14:14 (WORKING) | 18:24 (BROKEN) |
| --- | --- | --- |
| reply-target render | FULL quote + `Attachments:` block w/ descriptions | DEDUPED stub + bare `[image/png: …]` |
| `<image filename=` count in prompt | 20 | 0 |

v3.0.0-beta.187 deployed 16:02 — between them. The agent's earlier
"not caused by beta.187" was WRONG: it verified one mechanism (the stub builder
predates the release) and inferred the scenario, the same error `00-critical.md`
§ "verifying the mechanism is not verifying the scenario" names.

**The delta is dedup state, not description production.** Vision succeeded in
BOTH cases. In the working capture the reference rendered full; in the broken one
it rendered as a deduped stub. What in beta.187 flips dedup on for this shape is
STILL UNIDENTIFIED — every file on the reference/dedup/persist path in the
release diff is comment-or-type-only.

**Data path (verified):** bot-client applies `buildDedupedReferenceStub`
(`ReferenceFormatter.ts:133`) BEFORE sending, and that builder rebuilds the
reference field-by-field WITHOUT `attachments` (`referenceEnrichment.ts:189-205`
— note line 199 hand-carries `authorRole`, the scar from the previous bug of this
exact class). But the preprocessing dependency job still runs: prod logs show
`referencedAttachmentCount=4 totalPreprocessed=4`. So descriptions DO reach
ai-worker via `preprocessedForRef`, decoupled from the stripped `ref.attachments`.

**Fix sites (all data is available at each):**
1. `QuoteFormatter.DedupedQuoteOptions` + `formatDedupedQuote` — accept and pass
   attachment lines / image descriptions. `formatQuoteElement` ALREADY renders
   `<image filename="…">` (line 105) — the deduped path simply never passes it.
2. `ReferencedMessageFormatter` deduped branch (~line 103) — build lines from
   `preprocessedForRef`, mirroring `formatStandardReference`.
3. `xmlMetadataFormatters` dedupedRefs.map (~line 122) — pass
   `ref.resolvedImageDescriptions` (already persisted for exactly this purpose).
4. Stub wording: "full text in the chat log" is FALSE for images — reword.

**Second defect — no self-heal (owner screenshot).** On a re-ask the character
still reports only URLs. `persistReferenceDescriptions` keys descriptions to the
TRIGGER row, so a later reply to the same message never finds them. Re-key to the
referenced message id / attachment content hash (council: K3, Qwen independently).

**Third finding — no fallback.** `extendedContextAttachmentCount=0`, so the
chat-log injection path (`RAGUtils.injectImageDescriptions`, which early-returns
on an empty map) produced nothing either.

**Observability is the top finding (owner):** four descriptions were computed,
succeeded, and were discarded with ZERO log output. The only detector was the
owner reading Discord.

**Council 3/3 (GLM 5.2 · Kimi K3 · Qwen 3.7 Max)** — all rejected option (b) and
(c); all chose (a) now + a PROJECTION refactor structurally (stub = full render
minus `content`, one-entry exclusion set). All three independently rejected the
agent's parity-allowlist test proposal as rubber-stamp-prone. Their test answer:
**enrichment traceability** — mock vision at the boundary returning sentinels and
assert the sentinels reach the final prompt ("paid work must appear"), which
catches the class regardless of which field is dropped next.
