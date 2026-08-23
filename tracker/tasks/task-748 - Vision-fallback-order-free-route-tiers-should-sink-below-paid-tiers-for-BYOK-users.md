---
id: TASK-748
title: >-
  Vision fallback order: free-route tiers should sink below paid tiers for BYOK
  users
status: To Do
assignee: []
created_date: '2026-08-23 15:44'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: high
ordinal: 748000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner directive (2026-08-23) - with a paid user-level key, openrouter/auto should be tried before openrouter/free, but composeVisionTiers (services/ai-worker/src/services/multimodal/describeImageWithFallback.ts) composes primary -> stamped [globalDefault, freeDefault] -> paid floor with no key-awareness, so prod chains run [qwen, openrouter/free, openrouter/auto] for everyone. In the 7da570d8 incident the free tier 429d at tier 2 before auto was reached.
Fix shape: pass key-presence into composeVisionTiers (callers already resolve userApiKey via resolveImageJobAuth / authOptions) and, when the user has a usable paid key, stable-sort free-route models (isFreeModel) below paid ones - primary always stays first (explicit config wins). Keyless/guest behavior unchanged (broad-free-fallback already converges them onto free at auth resolution). Land AFTER TASK-747 (same file, in-flight).
Acceptance: a BYOK user chain orders paid fallbacks before free-route ones (unit test on composeVisionTiers with hasUserKey true/false); guest chain unchanged; the 7da570d8 shape with a paid key reaches auto at tier 2.
<!-- SECTION:DESCRIPTION:END -->
