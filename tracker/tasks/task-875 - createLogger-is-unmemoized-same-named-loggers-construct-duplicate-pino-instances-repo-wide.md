---
id: TASK-875
title: >-
  createLogger is unmemoized: same-named loggers construct duplicate pino
  instances repo-wide
status: To Do
assignee: []
created_date: '2026-09-03 10:40'
labels:
  - 'area:common-types'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 875000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: createLogger (packages/common-types/src/utils/logger.ts:259) is a plain factory with no memoization, so every call builds a fresh pino instance. Prod code already calls it with the SAME name from multiple modules across all three services: api-gateway has 7 sites for createLogger(api-gateway) plus 3 each for AIRouter and db-sync; ai-worker has 9 duplicated names up to 3 sites each; bot-client has 6, including createLogger(bot-client) at index.ts, startup.ts and now serviceFactory.ts. Measured 2026-09-03 by grepping prod files (excluding *.test.ts by path) across services/*/src.

Cost: negligible in prod (a couple of serializer objects per instance). In local dev with ENABLE_PRETTY_LOGS=true, createLogger attaches a pino-pretty transport, which spins up a worker thread PER INSTANCE - so ~25 duplicate sites means ~25 extra dev worker threads. Same-named instances are also indistinguishable in output, so any future per-instance state (buffering, custom hooks, level overrides) would silently diverge between them.

Found by claude-review on PR 2314, which flagged the bot-client instance; the repo-wide counts above are the sweep that followed. The reviewer framed it as a regression introduced by that PR - it is not, it is one more instance of a pervasive existing pattern, which is why the fix belongs upstream rather than in that diff.

Fix shape: memoize createLogger by name in common-types (a Map from name to Logger, returning the existing instance on repeat calls). The design question to settle first: shared instances mean shared per-instance state, so check whether any caller mutates its logger (level overrides, child bindings held across calls) or relies on instance identity, and whether tests construct loggers expecting isolation. If sharing is unsafe for some callers, an opt-out parameter is the fallback.

Acceptance: a repeat createLogger(name) call returns the same instance, pinned by a colocated test; the dev pretty-logs path creates one transport per distinct name; pnpm test and pnpm quality stay green across all services.
<!-- SECTION:DESCRIPTION:END -->
