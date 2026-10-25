---
id: TASK-1284
title: >-
  z.ai coding-plan -> paid OpenRouter downgrade has no footer indication on at
  least one routing path
status: To Do
assignee: []
created_date: '2026-10-25 03:01'
labels:
  - 'area:bot-client'
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1272000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner report from prod 2026-10-25 (hedged, not log-verified): a z.ai-family turn served via PAID OpenRouter (user has their own OpenRouter key) after the coding plan was unavailable showed a model footer with NO fallback indication. Her framing: maybe keyed-user fallback is expected, but silent cost-bearing downgrades look odd.

Mapped architecture (code-read, 2026-10-25): ProviderRouter auto-promotes OpenRouter z-ai/<model> requests to z.ai-direct when a zai-coding key exists and the model is on the plan catalog; promotedRoute carries a fallback object so GenerationStep can swap back to OpenRouter if the promoted request fails. The sender (DiscordResponseSender) renders two signals into buildModelFooterText: fallbackProviderAttempted (promotion attempted AND failed) and fallbackFromProvider (a served fallback swap). Candidate gap: when plan unavailability is known at ROUTING time (free-tier quota gate / headroom), the request routes straight to OpenRouter - no promotion attempt, no served swap, neither flag sets, and the footer shows the model as configured even though the turn is now cost-bearing on the user key.

Acceptance: trace which routing paths set which flags for the coding-plan->OpenRouter case (promotion-failure swap, quota-gate upfront route, keyed vs free user); decide per path whether the footer should annotate (a paid downgrade is cost-bearing - the argument for yes is the same one that built the existing two signals); implement the missing flag(s)/footer copy; add the swap-mutation test. If silent-by-design wins for some path, document it in the footer-builder docstring.
<!-- SECTION:DESCRIPTION:END -->
