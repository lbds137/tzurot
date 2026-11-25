---
id: TASK-1484
title: >-
  Self-hosted Langfuse as a durable trace store, fed by OpenRouter request
  forwarding
status: To Do
assignee: []
created_date: '2026-11-21T00:05:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1484000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila 2026-11-20 (via Deck), on seeing OpenRouter's "Send these requests to Langfuse, Datadog, or LangSmith" panel in its logs view: "self-hosted sounds like it's the way to go". Tzurot's own trace store is the diagnostic table, kept 7 days (DIAGNOSTIC_LOG_RETENTION_HOURS, common-types constants/diagnostics.ts), which constrains evals such as TASK-1400 and debugging older turns. OpenRouter can forward a trace of every request to an observability destination with no code changes. Self-hosting (e.g. Langfuse on Railway beside Tzurot) keeps the copy on her own infrastructure, which matters because other users' chats would be forwarded too, not only hers.
Grounding: a git grep of develop tracker/docs/backlog for langfuse, langsmith, datadog, opentelemetry, otel and observability found no prior work (the only hits were otel inside Hazbin Hotel, a positive control that the pattern ran).
First step (unverified, check before building): which OpenRouter key and account carry which traffic (system key for prod, BYOK users' own keys, the or-claude Claude Code lane). Forwarding is account-wide, so the scope follows from that answer. BYOK users' traffic on their own keys would not be covered; say so in the design.
What: stand up self-hosted Langfuse (Railway, Postgres plus ClickHouse per its self-host docs; verify current requirements and cost), enable OpenRouter forwarding to it, set retention, and decide which users' traffic may be forwarded (her own; all; opt-in). That decision is hers: it is user data, and must also be reflected in the privacy policy and the data-export and deletion commitments (deletion means deletion).
Acceptance: a Tzurot turn on the forwarded key appears in Langfuse with prompt, completion, model, tokens and cost; the retention and user-scope decisions are recorded here; deletion and export obligations are covered or explicitly ruled.
Related: TASK-1400 (Claude eval; durable traces help), TASK-1431 (cache TTL on the diagnostic row), docs/proposals/backlog/agentic-scaffolding.md.
<!-- SECTION:DESCRIPTION:END -->
