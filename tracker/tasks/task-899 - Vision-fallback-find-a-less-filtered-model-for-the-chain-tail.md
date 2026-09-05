---
id: TASK-899
title: 'Vision fallback: find a less-filtered model for the chain tail'
status: To Do
assignee: []
created_date: '2026-09-05 15:40'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 897000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner direction 2026-09-05 — the vision chain (glm-5.3-flash → openrouter/auto → qwen/qwen3.5-397b-a17b) is deep but not diverse: every tier is mainstream-filtered, so on spicy artwork the first two refuse by policy and the chain is effectively one deep (board carried this as an owner-visible finding; TASK-880 recorded the prod episode). The owner asked to look into what is less censored as a fallback, and recalled the hard-coded Qwen tier as good apart from the timeout episode, which is TASK-880 (diagnostic shipped in #2323, awaiting the next occurrence).

Fix shape: research first, then a one-line change. (1) Enumerate OpenRouter vision-capable models and their stated content policy and moderation flags (the OpenRouter model catalog exposes a moderated field per model; probe it live rather than trusting memory), shortlist the ones that describe unfiltered or lightly filtered images, and record price and context per candidate. (2) Pick one as the LAST tier only — the chain order stays mainstream-first so ordinary images keep the current quality — and pin it as a code default beside the existing terminal in the vision chain config. (3) Acceptance: an owner smoke on dev with a known-refused artwork produces a description from the new tier, and `/inspect` shows the hop. Owner taste call on which candidate; present the shortlist with the moderation flag and price, do not pick silently.
<!-- SECTION:DESCRIPTION:END -->
