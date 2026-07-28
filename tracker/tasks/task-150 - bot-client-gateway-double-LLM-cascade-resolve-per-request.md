---
id: TASK-150
title: bot-client ↔ gateway double LLM-cascade resolve per request
status: To Do
assignee: []
created_date: '2026-06-17 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:bot-client'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 150000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

bot-client ↔ gateway double LLM-cascade resolve per request

**Why:** bot-client's `PersonalityChatManager.resolveConfig` resolves the LLM cascade (for context-size settings) AND the gateway's `createJobChain` now resolves it again (for model stamping, #1239) — the same cascade walked twice per request. Both are consistent (same logic), just redundant. **Fix shape**: single-resolution path — e.g. the gateway returns the resolved model+context in one response bot-client passes through, or bot-client forwards what it already resolved. Requires a bot-client↔gateway request-contract change. **Promote when**: the duplicate cascade shows up as measurable latency/DB load, or the contract is being reworked anyway. Surfaced 2026-06-17 by PR #1239. Deferred 2026-06-17.
<!-- SECTION:DESCRIPTION:END -->
