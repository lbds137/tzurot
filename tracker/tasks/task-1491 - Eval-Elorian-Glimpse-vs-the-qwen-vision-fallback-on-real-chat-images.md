---
id: TASK-1491
title: 'Eval: Elorian Glimpse vs the qwen vision fallback on real chat images'
status: To Do
assignee: []
created_date: '2026-11-21T03:47:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1491000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: elorian/glimpse (OpenRouter, Together only, $0.60/$3 per M, launched 2026-10-16) is a visual-reasoning model; its benchmark claims are vendor-only and skew to charts, counting and physical scenes, not chat captioning. Owner (2026-11-20): worth a test.

What: caption about 20 images with glimpse and with VISION_FALLBACK (packages/common-types/src/constants/ai.ts:281) using the production vision prompt, VISION_TEMPERATURE and VISION_MAX_TOKENS; blind side-by-side judging (seyag:eval, pre-registered). Image set: owner-supplied, including NSFW from her Google Photos takeout on Drive (owner offer 2026-11-20), plus screenshots, memes and art. Record per image: refusal or soft-refusal, accuracy, detail, tokens and cost (glimpse is reported to spend many tokens on close inspection).

Privacy: her personal photos go only to non-Chinese-hosted endpoints (memory: personal data never on Chinese-hosted lanes); pin the qwen arm to a non-Chinese OpenRouter provider and record which. Images stay in docs/local or job tmp, never committed.

Acceptance: a result doc with the pre-registered decision rule applied, and a recommendation on whether glimpse joins the vision catalog or replaces the fallback.

Image set (owner discussion 2026-11-20): clearly adult NSFW only. Leave out ABDL-themed and youthful-styled anime art: OpenRouter's image screen (docs: "This request contains prohibited content.") judges appearance, a false positive risks an account flag, and the eval gains nothing from those images. Log OpenRouter blocks (403 or prohibited-content error) separately from model refusals.
<!-- SECTION:DESCRIPTION:END -->
