---
id: TASK-393
title: >-
  Memory search embeds only 24% of its query — bge-small caps at 512 tokens,
  references never reach it
status: To Do
assignee: []
created_date: '2026-08-01 18:05'
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
<!-- SECTION:DESCRIPTION:END -->
