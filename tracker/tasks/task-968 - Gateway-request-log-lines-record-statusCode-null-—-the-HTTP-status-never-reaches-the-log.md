---
id: TASK-968
title: >-
  Gateway request log lines record statusCode: null — the HTTP status never
  reaches the log
status: To Do
assignee: []
created_date: '2026-09-13 19:23'
updated_date: '2026-09-18 21:30'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 964000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced 2026-09-13 while building TASK-957. The seam test over the real createLogger + pino-http chain (services/api-gateway/src/middleware/requestLogger.test.ts) and a direct express probe both show the serialized response as exactly {"statusCode":null} on every request completed line, even for a 200 — so the gateway request log has never recorded an HTTP status, and a 4xx/5xx burst is invisible from the request lines alone. A raw node:http probe showed statusCode and headers populated, so the null is specific to the express + pino-http path. MECHANISM NOW FOUND and runtime-confirmed 2026-09-18 — see the second comment below; it is `formatters.log` in `createLogger`, not pino-http and not the sanitized serializers. The original "not a security item; an observability gap" reading is SUPERSEDED: fixing this starts logging response headers (`set-cookie` included) for the first time and switches on a redaction arm that has never executed.
Fix shape: reproduce in the seam test (assert entry.res.statusCode === 200 — it will red), then find why pino-std-serializers reads null on the express response object at log time (express sets statusCode on res; check whether pino-http logs on the finish event before express writes the head, or whether a wrapped/proxied res object is being serialized), fix at the middleware (a custom res serializer reading res.statusCode explicitly is the fallback), and keep the assertion as the pin. Also read the currently-pinned test does not carry response headers into the log line, which asserts the exact key set [statusCode] — it stays true.
Acceptance: a request completed line carries the real HTTP status for 2xx and 4xx; the seam test asserts it; the existing header-redaction assertions are unchanged.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-13 22:14
---
Runtime-confirmed in PROD 2026-09-13 on beta.224, not only in the seam test: of 23 gateway request lines pulled to a file, 23 carry "statusCode":null and 0 carry a numeric status. The defect is live in production, not a test artifact.
---
created: 2026-09-18 18:05
---
MECHANISM FOUND, runtime-confirmed by A/B probe (2026-09-18). It is NOT pino-http and NOT the sanitized serializers — both are correct in isolation. It is `formatters.log` in `createLogger` (grep -n "formatters" packages/common-types/src/utils/logger.ts).

The differential, four probes, everything else held constant:
- plain pino + pino-http, no formatters -> res={"statusCode":418,"headers":{...}}
- parent `res` serializer added as pass-through -> still 418 + headers
- real createLogger + createRequestLogger -> res={"statusCode":null}
- plain pino + ONLY a `formatters.log` that rebuilds objects from Object.entries -> res={"statusCode":null}

Chain: pino runs `formatters.log` on the merge object BEFORE the `res` serializer. `sanitizeObject` rebuilds the raw express ServerResponse from `Object.entries`, which keeps own enumerable props but DROPS prototype getters and methods. pino-std-serializers 7.1.0 `resSerializer` then evaluates `res.headersSent ? res.statusCode : null` — `headersSent` is a prototype getter, so the copy has `undefined`, which is falsy, so it emits null. The same copy has no `getHeaders` method, so `res.getHeaders ? res.getHeaders() : res._headers` yields undefined and the `headers` key disappears entirely.

TWO CONSEQUENCES THAT CHANGE THIS TASK:

(1) The premise "Not a security item; an observability gap" in the description above is WRONG and should not be carried into the fix. Response headers are absent today only because the formatter destroys the object. Fix the ordering and response headers — `set-cookie` included — START reaching the log line for the first time. The response-header redaction arm in logSanitizer is therefore DEAD CODE that has never executed in this path, and the fix is what makes it live. It must be proven to work in the same PR, not assumed.

(2) `requestLogger.test.ts` has enshrined the damage. Its second case asserts `expect(Object.keys(entry.res)).toEqual(['statusCode'])` under a comment claiming "the serialized res on this path holds only statusCode, so there is no response header to redact today" — that reasoning is wrong, and its sibling assertion `expect(output).not.toContain(RESPONSE_SENTINEL)` currently passes for the wrong reason (the set-cookie was destroyed, not redacted). Both need rewriting as part of the fix, and the comment's claim needs deleting rather than editing.

Consequence for sizing: this is no longer `size:S`. The fix touches a shared logger used by every service, and it switches on a redaction path that has never run.
---
<!-- COMMENTS:END -->
