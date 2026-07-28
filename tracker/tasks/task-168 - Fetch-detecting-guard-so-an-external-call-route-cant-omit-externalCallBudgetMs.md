---
id: TASK-168
title: >-
  Fetch-detecting guard so an external-call route can't omit
  externalCallBudgetMs
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:api-gateway'
  - 'area:tooling'
  - 'size:M'
dependencies: []
priority: low
ordinal: 168000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Fetch-detecting guard so an external-call route can't omit `externalCallBudgetMs`

**Why:** #1323's manifest invariant test (`timeoutMs >= externalCallBudgetMs + overhead`) only fires for routes that DECLARE `externalCallBudgetMs`. A future route whose handler does external I/O but forgets to declare a budget slips through silently — the second layer the declared-field approach doesn't cover. **Fix shape**: a lint/guard (`pnpm ops guard:...`) that flags an api-gateway route handler containing `fetch(`/external-client calls whose manifest route lacks `externalCallBudgetMs`. Hard to make precise (handler→route linkage), so a heuristic with an allowlist may be the pragmatic shape. **Promote when**: a new external-call route ships without a budget (the failure this prevents), or during a CI-guard hardening pass. Surfaced 2026-06-24 by PR #1323 (declared-field invariant is the first layer; this is the second).
<!-- SECTION:DESCRIPTION:END -->
