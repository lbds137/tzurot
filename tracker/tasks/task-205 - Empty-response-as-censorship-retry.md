---
id: TASK-205
title: Empty-response-as-censorship retry
status: To Do
assignee: []
created_date: '2026-07-05 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:ai-worker'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 205000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Empty-response-as-censorship retry — **VERIFIED 2026-07-05, partial**: empty completions ARE detected (LLMInvoker EMPTY_RESPONSE, retryable) and retried same-model with escalating params (temperature/frequency/history-reduction), final failure shows an honest user error. Missing: DIFFERENT-model fallback — no text-generation equivalent of the vision fallback chain exists. **Home: the profiles design** (paid+free fallback container, model-configuration-overhaul theme) — a targeted retry-with-free-default could ship earlier if the pain is real.

**Why:** The remaining gap is a product design call, not a bug.
<!-- SECTION:DESCRIPTION:END -->
