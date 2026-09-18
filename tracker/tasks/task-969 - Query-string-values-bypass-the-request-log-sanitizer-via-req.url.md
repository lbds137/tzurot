---
id: TASK-969
title: Query-string values bypass the request-log sanitizer via req.url
status: Done
assignee: []
created_date: '2026-09-13 20:34'
updated_date: '2026-09-18 23:57'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 965000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the gateway request line (pino-http, services/api-gateway/src/middleware/requestLogger.ts) carries req.url verbatim; the sanitizer in packages/common-types/src/utils/logSanitizer.ts redacts by KEY (header names, field names, key substrings) and by value pattern on string FIELDS, so a secret carried as a query-string value inside the url string is never seen by either arm. Not a leak today: `grep -rn -E "req\.query" services/api-gateway/src --include=*.ts | grep -v test` (2026-09-13) names only filters and ids (slug, period, guildId, discordMessageId, scope, timeframe, sinceDays, wait) plus schema-parsed filter objects; no route reads a token, key, or secret from the query string. Filed from PR 2417 review round 2.
Fix shape: in the request serializer, parse req.url and redact the VALUE of any query key that matches the sensitive-key rules (isSensitiveField), leaving the path and other keys intact; or, cheaper, redact the whole query string when any key matches. Pin with a seam test over the real pino-http chain (requestLogger.test.ts pattern) sending ?api_key=<sentinel> and asserting the sentinel is absent from the line while the path survives.
Acceptance: a query-string value under a sensitive key never reaches the request line; non-sensitive query keys still log; the seam test reds when the url arm is removed.
Promote when: any gateway route starts accepting a credential in the query string (grep above stops being empty of secret-shaped keys).
<!-- SECTION:DESCRIPTION:END -->
