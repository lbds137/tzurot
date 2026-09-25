---
id: TASK-1023
title: >-
  isSensitiveField misses hyphenated api-key names, now reachable from query
  strings
status: Done
assignee: []
created_date: '2026-09-18 23:57'
updated_date: '2026-09-25 08:03'
labels:
  - 'area:common-types'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1019000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review on PR #2454 (low, non-blocking), and a merits call rather than an origin-scoped dismissal. matchesApiKeyPattern in packages/common-types/src/utils/logSanitizer.ts tests only the substrings apikey and api_key, and SENSITIVE_HEADER_NAMES carries the exact name x-api-key but not a bare api-key. So a field or query parameter named literally api-key passes the predicate unredacted, while the semantically identical header form is caught.

What changed with #2454, and why it is not merely pre-existing: that PR applied this predicate to query-string parameter NAMES for the first time. Object keys and header names are chosen inside this codebase; query parameter names are chosen by whoever builds the request. The gap therefore moved from internally-named fields to an external-input-controlled surface, which is a change in reachability rather than a change in the predicate.

Current exposure is bounded: a 2026-09-18 sweep of req.query across api-gateway routes found only filters and ids, no route reading a token, key, or secret from the query string. So this is defence in depth on top of defence in depth, which is why it is filed rather than ridden along on an already-green PR.

Fix shape: widen the api-key arm to cover the hyphenated form, and sweep the same question across the other arms (secret, token, password, authorization) for separator variants the substring checks miss. The widening is a shared predicate used by object, header and query redaction at once, so it needs its own unit with tests on BOTH sides of the boundary: a hyphenated name redacts, and a metadata-shaped name in API_KEY_METADATA_FIELDS still does not over-redact. Check that allowlist for hyphen variants while there.

Acceptance: a field or query parameter named api-key is redacted wherever apikey already is; the metadata allowlist still exempts what it exempted before; tests pin both directions and redden when the new arm is removed.
<!-- SECTION:DESCRIPTION:END -->
