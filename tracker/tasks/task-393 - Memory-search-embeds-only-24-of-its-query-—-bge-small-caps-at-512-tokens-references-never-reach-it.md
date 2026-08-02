---
id: TASK-393
title: >-
  Memory search embeds only 24% of its query — bge-small caps at 512 tokens,
  references never reach it
status: Done
assignee: []
created_date: '2026-08-01 18:05'
updated_date: '2026-08-02 16:20'
labels:
  - 'size:M'
  - 'area:ai-worker'
  - 'area:embeddings'
dependencies: []
priority: high
ordinal: 393000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Measured 2026-08-01** with the real tokenizer against a prod /inspect capture (req `456ec221-120e-4822-bcc3-c12e08c2ea78`).

**The numbers**: the `searchQuery` on that request was **2,093 tokens**. `Xenova/bge-small-en-v1.5` has `model_max_length: 512` and `max_position_embeddings: 512`, and transformers.js hardcodes `truncation: true` in `FeatureExtractionPipeline._call`. So **1,581 tokens — 75.5 percent of the query — were silently discarded** before the embedding was computed.

**What survives is the wrong part.** `SearchQueryBuilder.buildSearchQuery` concatenates unboundedly in this order: optional recentHistory, userMessage, attachmentDescriptions, referencedMessagesText. On this request the user text was ~40 chars, followed by a URL, then a **1,700-char image description** of a gym photo (visual inventory: hair colour, sports bra, rubber flooring, a wall logo). The 512-token window ran out partway through the FIRST reference quote.

**Consequence — a silent no-op.** `referencedMessagesText` is appended explicitly for better memory recall and logs `Including referenced message content in memory search query`. With any sizable attachment description ahead of it, it is always at the tail and always truncated away. The log line asserts work that did not happen.

**Corroborating symptom in the same capture**: all 20 retrieved memories scored in a 0.028 band (0.635 to 0.663). That flatness is what a diluted query vector looks like — nothing matches strongly because the vector averages gym equipment with emotional text.

**The codebase already knows this failure mode.** `shouldFoldSearchQuery` (`prompt/queryFoldGate.ts`) exists because folding recent history into a content-rich query was MEASURED to push on-topic memories out of top-K. Attachment descriptions are the same dilution from a source that gate does not cover.

**Fix shape (needs design, not just a cap)**: options include (a) budget the query to 512 tokens with explicit per-part allocation so every part contributes something; (b) truncate attachment descriptions to a lead sentence for search purposes while keeping the full text for the prompt; (c) reorder so references precede attachment descriptions; (d) embed parts separately and combine. Note (c) alone just moves which part gets dropped.

**Verify first**: confirm the score-flatness correlation on a second capture with a large attachment and on one without, before assuming the retrieval-quality link. The truncation itself is already proven.

**Acceptance**: the embedded query is bounded to the model window by construction, every intended part is represented, and no log claims a contribution that truncation removed.

## SPLIT 2026-08-01 — measurement SHIPPED (#1893), allocation policy still open

The acceptance criteria above bundle two different kinds of work. The third
clause shipped; the first two are blocked on evidence that does not exist yet.

**Shipped in #1893** — the problem is now observable instead of invisible:

- `EMBEDDING_MAX_INPUT_TOKENS` names the 512 constraint, pinned by test to the
  vendored model config so a model swap breaks the test rather than silently
  invalidating every warn.
- The worker counts with the model OWN tokenizer before the pipeline runs
  (calling it bare is what yields the pre-truncation length) and reports
  `inputTokens`; `LocalEmbeddingService` warns on overflow with the discarded
  count and observed chars-per-token.
- `SearchQueryBuilder` no longer logs `Including referenced message content in
  memory search query` — the claim it could not verify. It reports the
  assembled composition with each part offset instead, so a starved part is
  visible as an offset already past the window.

**NOT shipped, deliberately: which text wins the window.** The four options in
the fix-shape above are not equally safe, and the project already has data
saying the obvious one is risky. `reports/goldens-mining/fold-ab-result.md`
measured dilution on content-rich queries as monotonically harmful — recall@10
fell 0.436 to 0.390 to 0.256 to 0.195 as the fold widened. Option (a),
per-part allocation, guarantees every part contributes, which is the same shape
as the fold that lost. It may still be right; it is not obviously right.

**The blocker is a goldens gap, and it is concrete.**
`reports/goldens-mining/conversation-goldens.json` holds 40 mined turns whose
`messageMetadata` carries only `referencedMessages` — **zero attachment-bearing
turns**. No query of the shape this task is about has ever been scored, so
every option here would be shipped on reasoning alone. That is exactly the
circularity the pre-registered fold gate was designed to avoid.

**Prerequisite before any allocation change**: mine goldens that include
attachment-bearing turns (image descriptions especially, since they are the
long dominant part), then A/B the options the same way the fold was A/B-d. The
miner is `packages/tooling/src/memory/mine-conversation-goldens.ts`.

**Promote when**: attachment goldens exist, OR the new overflow warn shows a
high enough rate in prod to justify prioritising the mining. The warn is how
that rate becomes knowable — grep ai-worker for
`Input exceeded the model window`.

## 2026-08-02 — goldens gap CLOSED (PR #1900); promote condition met

**The prod-warn arm cannot fire yet**: #1893 (`449e110a7`) is on develop,
unreleased — prod (beta.189) still emits the OLD
`Including referenced message content in memory search query` line the PR
deleted (verified in a 5,000-line prod ai-worker window). Re-check the warn
rate after the next release ships.

**The goldens arm is done instead.** `pnpm ops memory:mine-attachment-goldens`
(PR #1900) mined **24 attachment goldens (16 image / 8 voice)**, each with the
bare-message/attachment-block split and the fold history window, into
`reports/goldens-mining/attachment-goldens.json` (local-only, additive beside
the judged conversation set).

**Two findings from the mining probe** (dev copy of the synced history):

- `messageMetadata.attachmentDescriptions` has **no producer** — 0 of 4,020
  retained user turns carry it. Attachment text lives appended in `content`
  (`VisionDescriptionWriter` upgrades the placeholder row post-vision), so the
  miner splits by content marker. Dead schema surface filed separately.
- The overflow is the **median** case for attachment turns, not the tail:
  enriched-image turns run p50 3,654 chars / p90 12,550 / max 30,648 against
  the ~2,000-char (512-token) model window. 69 image + 44 voice turns in the
  persona's retained history (~7% of user turns).

**Next**: allocation A/B arms (current / per-part budget / lead-sentence /
reorder / separate-embeds) in the fold-aware eval harness
(`services/ai-worker/src/services/eval/foldAware*.eval.test.ts`), scored on
these goldens with the same pool→judge→qrels flow as the fold re-baseline.

## 2026-08-02 — allocation A/B SCORED (PR #1901); the evidence picked the policy

Harness shipped in #1901 (`pnpm eval:allocation-goldens` / `eval:allocation-score`);
pooled live against dev (24/24 goldens, 748 candidates, 633 guard-eligible),
judged same-protocol as the fold re-baseline (rubric in the local
`allocation-qrels.json`). Full table: local `allocation-ab-result.md`.

**The result INVERTS the fold prior — attachment text is signal, not dilution.**
Dose-response recall@10 rises monotonically with attachment text: bare 0.379 →
lead 0.482 → budget(≤1024 chars) 0.511 → current(full, embedder-truncated)
0.528. Paired flips vs production's `current`: `bare` net **−5** @10 (1 fix /
6 breaks — the `shouldFoldSearchQuery`-style gate is DEAD); `lead` net −1 (not
free); `budget` net **0** (0 fixes / 0 breaks, 23/24 both-hit —
indistinguishable from full text). Voice goldens: 0 misses in every arm (stored
voice rows carry the transcript in the bare text). Observed counter-pattern,
n=2: on reaction-gif turns the description drowns the gif-banter thread
(current breaks bare-hits there) — recorded, not actionable at this n.

**Decision (evidence-made): cap the attachment part of the search query at
half the window (~1024 chars, word-boundary), keep everything else as-is.**
It is measured-free on recall AND by construction un-starves
`referencedMessagesText`, which today is ALWAYS discarded behind a median-case
3,654-char description — restoring the behavior the builder already claims.
Rejected on evidence: bare/gating (−5), lead-sentence (−1). Reorder alone was
already ruled out in the original fix-shape (moves which part is dropped);
separate-embeds not needed given budget ≈ current.

**Remaining to close this task**: (1) ship the cap in
`SearchQueryBuilder`/`searchQueryBudget` with the eval arm importing the SAME
truncation code so measurement and policy can't drift; (2) post-release,
re-check the prod overflow-warn rate (`Input exceeded the model window`) —
after the cap it should fire only on pathological reference/multi-part turns.

## 2026-08-02 — SHIPPED (#1902); Done

The cap landed: `ATTACHMENT_SEARCH_BUDGET_CHARS` (1024 chars, word-boundary,
lone-surrogate-safe) in `prompt/searchQueryBudget.ts`, applied to the
`attachmentDescriptions` part; `allocationArms.ts` imports the same code so
the next A/B measures the shipped policy. Composition log gains
`attachmentCharsBeforeBudget` (present only when the cap bit). References now
reach the embedder on median attachment turns by construction.

The post-release verification (overflow-warn rate + cap bite rate) lives in
CURRENT.md § Watches — it is a calendar-gated check, not open work.
<!-- SECTION:DESCRIPTION:END -->
