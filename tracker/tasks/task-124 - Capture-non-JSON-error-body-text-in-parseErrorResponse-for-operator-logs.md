---
id: TASK-124
title: Capture non-JSON error body text in parseErrorResponse for operator logs
status: Done
assignee: []
created_date: '2026-05-24 00:00'
updated_date: '2026-07-30 14:27'
labels:
  - 'area:common-types'
  - 'size:S'
dependencies: []
priority: low
ordinal: 124000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Capture non-JSON error body text in `parseErrorResponse` for operator logs

**Why:** `packages/common-types/src/clients/errors.ts` `parseErrorResponse` catches non-JSON bodies (nginx 502, CDN HTML pages) and falls back to `{ message: 'HTTP <status>' }`, discarding the response body entirely. Operators debugging "why did the gateway 502?" see only the status code — no nginx error page text, no CDN diagnostic. **Fix shape**: have `parseErrorResponse` populate an optional `rawText?: string` field from `response.text()` on the catch path; `callGateway` forwards it through `onWarn`'s second argument so log infrastructure (pino, structured loggers) can surface the body. User-facing message stays `HTTP <status>`; operators get full context. **Promote when**: a production gateway 502/503 surfaces with no debug info, OR opportunistically alongside the next `errors.ts` change. Surfaced 2026-05-24 by PR #1090 rounds 11 + post-autosquash claude-bot reviews. Deferred 2026-05-24.
<!-- SECTION:DESCRIPTION:END -->
