---
id: TASK-735
title: >-
  Free vision floor is a text router — free-tier vision fails ~100%
  (model_not_found)
status: To Do
assignee: []
created_date: '2026-08-22 21:48'
updated_date: '2026-08-22 21:59'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 735000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner prod report 2026-08-22 (characters get the image placeholder). Measured across 5 prod deployments (Aug 14 -> 22): vision invocation failure rate has run 35-52% for a week (112/323, 113/258, 145/278, 115/452, 19/52), categories rotating: media_not_found (140 in the Aug 18-20 window — expired CDN URLs on re-vision), bad_request bursts (~100 on Aug 17), server_error, rate_limit, empty_response, and free-tier no-endpoint 404s. ~40 placeholder deliveries in the current 49h window, clustered in extended-context batches.
Mechanism, PROBE-CONFIRMED 2026-08-22 (dev key, free models, zero spend): openrouter/free IS vision-capable and the account data policy does NOT block it — an image request routed to google/gemma-4-31b-it:free which returned 429 temporarily-rate-limited-upstream (provider Google AI Studio); direct gemma-4-26b:free image call likewise 429. The free vision pool is effectively one chronically-saturated provider. The prod "404 No endpoints available matching your guardrail restrictions and data policy" errors are read as the router’s catch-all when that provider is temporarily delisted (inference from wording — not probe-pinned). Earlier "openrouter/free is a text router" claim in this task was WRONG and is retracted.
Fix shapes (owner-taste on guest spend/product): (a) diversify the free vision chain — add a second free vision tier from a DIFFERENT provider (e.g. dots-studio/dots-3-note-preview:free or nvidia/nemotron-3-nano-omni:free, both vision-flagged in /models browse) so one provider flap does not kill the chain; (b) separately triage the media_not_found class (expired Discord CDN URLs on re-vision — distinct bug class, may deserve its own task); (c) optional rule-out: owner glances at openrouter.ai/settings/privacy (demoted from likely-fix to rule-out by the probe).
Acceptance: free-tier vision probe succeeds through the shipped chain during a Gemma outage window (second tier absorbs); prod exhausted-chain rate drops; media_not_found class dispositioned (fixed or filed separately).
<!-- SECTION:DESCRIPTION:END -->
