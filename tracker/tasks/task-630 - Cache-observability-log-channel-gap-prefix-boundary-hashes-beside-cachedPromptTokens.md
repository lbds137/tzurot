---
id: TASK-630
title: >-
  Cache observability: log channel gap + prefix-boundary hashes beside
  cachedPromptTokens
status: Done
assignee: []
created_date: '2026-08-16 19:18'
updated_date: '2026-08-16 23:07'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 630000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: cachedPromptTokens is logged per request (Generated response line, LLMInvoker + ConversationalRAGService) but repeated prod zeros (d3c643f0, f6f73154) cannot be diagnosed — the line carries none of the variables that separate TTL expiry from prefix instability from a reporting artifact. Owner floated the gap 2026-08-16 ("are we missing data on what is going on with the caching"). Companion to the doc-17 TTL-bracket question and a prerequisite for judging the section 2.5 hysteresis win.

Fix shape (one small ai-worker PR): extend the generation log with (a) secondsSinceLastGenerationInChannel, derived from the already-loaded conversation history (no new state); (b) rolling hashes of the assembled prompt at 3-4 stable section boundaries (end of persona/system core, end of participants, end of chat_log minus the newest entry) so consecutive-request comparison localizes any byte instability without storing prompt content; (c) the cached/prompt hit ratio. Also verify once that the z.ai-direct path maps prompt_tokens_details.cached_tokens into input_token_details.cache_read — an unmapped field logs as a fake zero.

Acceptance: one day of prod traffic can be bucketed by grep into TTL-shaped misses (identical hashes, long gap), instability misses (hash flip, names the boundary), and reporting artifacts (verified mapping); no prompt content or PII in the new fields.
<!-- SECTION:DESCRIPTION:END -->
