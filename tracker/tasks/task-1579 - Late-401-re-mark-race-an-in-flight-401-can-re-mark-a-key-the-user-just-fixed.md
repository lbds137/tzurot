---
id: TASK-1579
title: 'Late-401 re-mark race: an in-flight 401 can re-mark a key the user just fixed'
status: To Do
assignee: []
created_date: '2026-11-27T23:32:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1569000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the invalid mark value carries no key identity, so the wallet-update subscriber can clear a mark and an in-flight request on the OLD revoked key can then write a fresh one — demoting the NEW valid key for 10 minutes with the "OpenRouter key rejected" footer, exactly when users retry. Window is short (401s return fast) but this is the natural user action sequence. Source: claude-review round 7 (cycle 5) finding 2 on PR #2829; reviewer notes the credit mark has the same race already (pre-existing) — this PR adds a second instance.
Fix shapes (pick one): (a) store a short fingerprint of the failing key (sha256Hex prefix) in the mark and ignore marks whose fingerprint does not match the current route.apiKey at read time; or (b) have the wallet-update clear record a clear-epoch timestamp and ignore marks whose ts predates the request start.
Acceptance: a test where the mark is cleared mid-request and the late 401 does NOT re-mark; the chosen fix applied to BOTH the invalid and credit marks (the race is shared).
<!-- SECTION:DESCRIPTION:END -->
