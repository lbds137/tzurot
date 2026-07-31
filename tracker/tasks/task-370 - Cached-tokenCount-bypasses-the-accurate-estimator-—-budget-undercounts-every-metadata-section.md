---
id: TASK-370
title: >-
  Cached tokenCount bypasses the accurate estimator — budget undercounts every
  metadata section
status: To Do
assignee: []
created_date: '2026-07-31 01:03'
labels:
  - 'area:ai-worker'
dependencies: []
priority: high
ordinal: 370000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Owner-directed 2026-07-30**: _"we should just be counting metadata as part of the budget. I don't think we need a separate render lever. messages included should already be truncated if they don't fit in the budget. we just need to fix the calculation to be accurate to what the LLM gets."_ Correct call — the render bound already exists (the token budget); it is simply lying, and a second lever would compensate for a broken measurement instead of fixing it.

**The estimator is NOT the problem.** `getFormattedMessageCharLength` (`services/ai-worker/src/jobs/utils/conversationLengthEstimator.ts:191`) accounts for all five metadata sections — referencedMessages, imageDescriptions, embedsXml, voiceTranscripts, reactions — plus the forwarded-quote wrapper. That is 1:1 with what `formatConversationHistoryAsXml` emits (formatQuotedSection / formatImageSection / formatEmbedsSection / formatVoiceSection / formatReactionsSection). It was written carefully.

**The problem is that it is bypassed.** Budget call sites prefer a DB-cached `tokenCount`, and that value is `countTextTokens(content)` — CONTENT ONLY (`packages/conversation-history/src/ConversationHistoryService.ts:107`). Since the count is written at insert, it is essentially always present, so the accurate estimator is the fallback that almost never runs.

Known call sites with the `tokenCount ?? estimator` shape:
- `services/ai-worker/src/services/context/ContextWindowManager.ts:162` — the PRIMARY history trimmer
- `services/ai-worker/src/services/context/CrossChannelSerializer.ts:65`
- `packages/common-types/src/utils/tokenCounter.ts:146` reads `messages[i].tokenCount` — verify whether it is a budget path

**Effect**: every prompt is larger than the budget believes, by the full rendered size of quoted messages, image descriptions, embeds, transcripts, and reactions. Worst on exactly the messages this session made richer.

**Fix shape**: make the cached value mean what its consumers assume. Either compute `tokenCount` over the RENDERED form rather than raw content, or stop preferring it in budget paths and always run the estimator (measure the cost first — the cache exists for a reason). Do NOT add a second render lever.

**Same class as everything else in this arc**: a fast path and a correct path that must agree, with nothing enforcing it — and a cache used as a system of record (doc-56's thesis, third instance).

**Acceptance**: an executable parity check. Render a message with EVERY metadata section populated, compare the budget's number against the real rendered token count, and fail on drift beyond a stated tolerance. That makes the estimator/renderer pair self-policing instead of hand-synced (task-368's class).

**Exhaustive sweep still owed** (owner asked for it explicitly): enumerate every budget/truncation decision in the prompt-assembly path, not just these three, and confirm each measures the rendered form. Enumerate deterministically — grep every `tokenCount` consumer AND every call site of the estimator — rather than sampling.

## CORRECTION — "the estimator is NOT the problem" is only true section-by-section

Found while building TASK-365's attachment-vocabulary PR. The claim above holds
at the level it was checked (all five sections are ACCOUNTED FOR) and fails one
level down: `estimateReferenceLength` (same file, top) models a `<quote>` shape
the renderer has not emitted for some time. Read side by side:

| Estimator emits | `formatQuoteElement` actually emits |
| --- | --- |
| `author="…"` | `from="…"` |
| `location="…"` as an ATTRIBUTE | `locationContext` as a child ELEMENT |
| `forwarded="true"` | `type="forward"` |
| — | `<time …/>`, `role`, `username`, `from_id`, `number` |
| ~~`resolvedImageDescriptions` not counted at all~~ | ✅ CLOSED — see below |
| ~~every attachment estimated as an `<image>`~~ | ✅ CLOSED — see below |

So a reference's estimate can be wrong by the entire length of its vision
descriptions — the largest single term a quoted message contributes, and exactly
the term the retention work is about to make more common.

**The attachments portion is CLOSED, and it closed by proving the fix shape.**
TASK-365's PR-1 first tried to mirror the renderer by hand and got it wrong in
two directions at once (every attachment estimated image-shaped: a voice message
lost its `duration`, a plain file gained a `status` it can never carry). Two
independent reviews caught it. The answer was not a better mirror — it was to
delete the mirror: the estimator now calls `buildStoredAttachments` +
`renderAttachment`, the same pair the prompt renders through, and a parity test
in `conversationUtils.test.ts` fails the moment anyone reintroduces a local copy.

**That is the template for the rest of this task.** The surrounding `<quote>`
estimate is still hand-written and still disagrees with the renderer on
attribute names — do the same thing to it: call `formatQuoteElement` and measure.
It also subsumes the acceptance check written above, because a parity test
between two renderers is unnecessary when there is only one.
<!-- SECTION:DESCRIPTION:END -->
