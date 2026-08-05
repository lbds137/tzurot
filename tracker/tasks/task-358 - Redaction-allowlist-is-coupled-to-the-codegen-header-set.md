---
id: TASK-358
title: Redaction allowlist is coupled to the codegen header set
status: To Do
assignee: []
created_date: '2026-07-30 14:26'
updated_date: '2026-08-04 13:56'
labels:
  - 'size:S'
  - 'area:clients'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 358000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Why:** `redactTransmittedValues` in `packages/clients/src/clients/transport.ts` strips
`NEVER_LOG_HEADERS` (X-Service-Auth, X-User-Username, X-User-DisplayName) out of
`rawText` before it reaches a log. That list is exhaustive for TODAY's senders
because `callGateway` is only invoked from codegen'd clients, which emit a fixed
header set in fixed casing — both review rounds on #1871 grepped and confirmed
this independently. Two coupling points make it fragile rather than wrong:

1. The lookup is an exact-key match, so a caller using different header CASING
   (`x-user-username`) would bypass redaction silently.
2. A direct `callGateway` caller outside the codegen template that adds a new
   sensitive header via `extraHeaders` would not be covered.

`transport.ts`'s own file header anticipates exactly that second case ("ai-worker /
api-gateway internal callers tomorrow"), which is why this is filed rather than
dismissed — the migration is planned, not hypothetical.

**Fix shape**: when the first non-codegen `callGateway` caller lands, either
(a) normalize header keys to lowercase before the `NEVER_LOG_HEADERS` lookup, or
(b) invert the model — redact every header value EXCEPT an explicit safe-list
(`X-User-Id`, `X-Request-ID`, `Content-Type`), which fails closed for anything
new. (b) is the more robust direction but needs care: blanket redaction of short
fixed tokens like `false` / `application/json` corrupts the very text `rawText`
exists to preserve, which is why the current allowlist is deliberately narrow.

**Promote when**: a direct `callGateway` caller outside the generated clients
appears (grep: callers of `callGateway` not in `_generated/` or
`method-builder.ts`), OR any header is added to the codegen template.

Surfaced 2026-07-30 by #1871 rounds 4+5 review (non-blocking in both).
<!-- SECTION:DESCRIPTION:END -->
