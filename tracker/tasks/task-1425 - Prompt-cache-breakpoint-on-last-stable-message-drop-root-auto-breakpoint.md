---
id: TASK-1425
title: 'Prompt cache: breakpoint on last stable message, drop root auto-breakpoint'
status: Done
assignee: []
created_date: '2026-11-16T19:48:00Z'
updated_date: '2026-11-16T20:48:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1425000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Prod 11-13 (Lila, opus-5.5, req 30322156): prompt 98,487, cached 10,365 (system only), cache write 88,118 every turn. Cause: the root cache_control (OpenRouter automatic mode, OpenRouterFetch.ts:163-165) puts its breakpoint at the END of the request, which is the final user message carrying the 24-44k-char per-turn volatile block (memory_archive, facts, voice_anchor...). That message shrinks to ~500 ch once it becomes history, so the written entry never matches again; only the explicit system breakpoint reads. At 1h-tier write pricing (2x) this costs MORE than no caching.

Probe 2026-11-16 (haiku-5.5 via OpenRouter, prod wire shape, 3 turns, ~22k prompt): prod shape reads 7,017 (system) and writes ~15,050 every turn, 0.00308 USD/turn; explicit breakpoints on messages[0], messages[1], messages[len-2] (no root) read 16,036 then 16,046 and write 10-12 tokens, 0.00077 USD/turn (-75%). Turn 3 read through turn 2 penultimate breakpoint, so lookback works.

Fix: drop the root cache_control; explicit per-block breakpoints on the system message, messages[1] (cross-channel block or oldest history head, stable under ContextWindowManager hysteresis), and the message before the final one; never the final message; skip empty/non-text targets; dedupe (max 3, Anthropic limit 4). Acceptance: dev same-model pair shows cached ~ prompt minus the per-turn block with a small write; one pair >5 min apart confirms 1h per-block TTL. Out of scope (her call, prompt placement): moving voice_anchor/personality_traits into the system prompt.
<!-- SECTION:DESCRIPTION:END -->
