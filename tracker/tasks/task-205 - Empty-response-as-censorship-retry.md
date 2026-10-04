---
id: TASK-205
title: Empty-response-as-censorship retry
status: To Do
assignee: []
created_date: '2026-07-05 00:00'
updated_date: '2026-10-04 16:47'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 205000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Empty-response-as-censorship retry — **VERIFIED 2026-07-05, partial**: empty completions ARE detected (LLMInvoker EMPTY_RESPONSE, retryable) and retried same-model with escalating params (temperature/frequency/history-reduction), final failure shows an honest user error. Missing: DIFFERENT-model fallback — no text-generation equivalent of the vision fallback chain exists. **Home: the profiles design** (paid+free fallback container, model-configuration-overhaul theme) — a targeted retry-with-free-default could ship earlier if the pain is real.

**Why:** The remaining gap is a product design call, not a bug.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: intake-agent
created: 2026-10-04 16:47
---
Intake 2026-10-04: a new specimen of the same gap class (provider "400 Provider returned error" on qwen/qwen3.8-omni-flash, user saw an error instead of a fallback) is TASK-1161. Staleness note to verify here: the claim that no text-generation fallback equivalent exists predates quotaFallback.ts (RETARGETABLE_CATEGORIES includes EMPTY_RESPONSE, SERVER_ERROR, TIMEOUT, NETWORK, CENSORED), so re-check what remains of this task against the code before building.
---
<!-- COMMENTS:END -->
