---
id: TASK-231
title: 'Classifier: plain-Error wrapper throws lose the transport kind'
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 231000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Classifier: plain-Error wrapper throws lose the transport kind — `classifyGatewayFailure`'s plain-`Error` branch extracts the wrapper-format message and always renders `gatewayRejection` — it never reaches `specForKind`, so a read TIMEOUT thrown as `new Error('...: 500 - ...')` (e.g. `checkExistingCharacter` in character/import.ts) renders a flat message instead of the read-timeout shape. Not unsafe (never renders write-uncertain copy) but inconsistent with the typed carriers. **Fix shape**: either convert the remaining plain-Error wrapper throws to `GatewayApiError` (kind preserved — same move as character/api.ts in PR-C), or teach the plain-Error branch `opts.operation` awareness before defaulting to gatewayRejection. Same family (string-collapse RESULT wrappers, kind destroyed upstream): `persona/api.ts` `deletePersona` (`{success, error?}`) and `characterCache.ts` `getCachedPersonalities` (`{kind:'error', error: string}`) — widen to carry the fail-arm so their callers can classify (persona delete + randomPick render generic today). **Promote when**: PR-D3 (natural rider — both named in the D3 task). Surfaced 2026-07-08 (PR #1554 + #1555 reviews).

**Why:** Consistency of the classifier's carrier matrix.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. `classifyGatewayFailure` (`ux/catalog/classify.ts:150`) still has its plain-`Error` branch (`instanceof Error` check at line 188) that collapses to `gatewayRejection` without reaching `specForKind`. Widely used (~70+ call sites across commands). Real cost prevented: inconsistent error rendering (e.g. read timeouts flattened). Promote-when (PR-D3 natural rider) hasn't landed yet. Evidence: `git grep -n "export function classifyGatewayFailure"` and the `instanceof Error` branch both confirmed present and unchanged.
---
<!-- COMMENTS:END -->
