---
id: TASK-968
title: >-
  Gateway request log lines record statusCode: null — the HTTP status never
  reaches the log
status: To Do
assignee: []
created_date: '2026-09-13 19:23'
updated_date: '2026-09-13 22:14'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 964000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced 2026-09-13 while building TASK-957. The seam test over the real createLogger + pino-http chain (services/api-gateway/src/middleware/requestLogger.test.ts) and a direct express probe both show the serialized response as exactly {"statusCode":null} on every request completed line, even for a 200 — so the gateway request log has never recorded an HTTP status, and a 4xx/5xx burst is invisible from the request lines alone. A raw node:http probe showed statusCode and headers populated, so the null is specific to the express + pino-http path; the mechanism was NOT chased (the observation is pinned, the cause is not). Not a security item; an observability gap.
Fix shape: reproduce in the seam test (assert entry.res.statusCode === 200 — it will red), then find why pino-std-serializers reads null on the express response object at log time (express sets statusCode on res; check whether pino-http logs on the finish event before express writes the head, or whether a wrapped/proxied res object is being serialized), fix at the middleware (a custom res serializer reading res.statusCode explicitly is the fallback), and keep the assertion as the pin. Also read the currently-pinned test does not carry response headers into the log line, which asserts the exact key set [statusCode] — it stays true.
Acceptance: a request completed line carries the real HTTP status for 2xx and 4xx; the seam test asserts it; the existing header-redaction assertions are unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-13 22:14
---
Runtime-confirmed in PROD 2026-09-13 on beta.224, not only in the seam test: of 23 gateway request lines pulled to a file, 23 carry "statusCode":null and 0 carry a numeric status. The defect is live in production, not a test artifact.
---
<!-- COMMENTS:END -->
