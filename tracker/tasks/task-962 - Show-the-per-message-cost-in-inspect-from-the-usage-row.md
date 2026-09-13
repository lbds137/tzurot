---
id: TASK-962
title: Show the per-message cost in /inspect from the usage row
status: To Do
assignee: []
created_date: '2026-09-13 17:24'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 959000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: shapes.inc surfaces the exact cost, credits used, and engine for every message. Tzurot already records tokens per generation in usage_logs and shows the model in the reply footer, but nowhere renders what one message cost. /inspect is the natural home (it already shows the model, routing, and token budget).
Fix shape: in the /inspect payload or its bot-client render, add a cost line derived from the usage row for that request (prompt/completion tokens × the model price where a price is known; tokens only where it is not — say which). No new storage. Check the OpenRouter model cache for a per-token price field before adding a price table.
Acceptance: /inspect on a reply shows tokens and, where the model has a known price, the cost; the render falls back to tokens-only without an error when no price exists.
<!-- SECTION:DESCRIPTION:END -->
