---
id: TASK-957
title: >-
  Gateway request logs carry the raw x-service-auth header value on every
  request line
status: Done
assignee: []
created_date: '2026-09-13 17:02'
updated_date: '2026-09-13 21:09'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 954000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed 2026-09-13 on the dev api-gateway deployment — every pino-http request line (request errored, request completed) serializes req.headers in full, including x-service-auth, the internal service secret. 134 of 1,506 lines in one 5,000-line window carried it. Prod runs the same logger config (services/api-gateway/src/index.ts app.use(pinoHttp({ logger })) with the common-types logger, whose sanitizedObjectSerializer did not strip this header), so the prod secret is in Railway prod logs too — inferred from the shared code path, not observed. Security-sensitive: anyone with Railway log access holds the service-to-service secret, and any log pull into a session transcript copies it (that happened once, on dev, 2026-09-13).
Fix shape: pass pino redact paths for req.headers["x-service-auth"], authorization, cookie, and set-cookie (or extend sanitizedObjectSerializer to redact them by header name); one test that serializes a req carrying the header and asserts [REDACTED]; canary by removing the path and watching it red. Sweep every other pinoHttp / request-logging site across services (grep -rn "pinoHttp\|pino-http" services packages --include=*.ts) so the class closes, not the instance. After the fix ships to prod, the owner rotates INTERNAL_SERVICE_SECRET on dev and prod (coordinated: every service reads it) — the rotation is the owner action; this task is the redaction.
Acceptance: no request log line on any service carries the x-service-auth value; a test pins the redaction; the sweep result (every request-logger site and its disposition) is in the PR body.
<!-- SECTION:DESCRIPTION:END -->
