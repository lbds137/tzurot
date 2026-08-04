---
id: TASK-401
title: 'cache:prefix-diff follow-ups: --limit ceiling + Cache Commands doc section'
status: Done
assignee: []
created_date: '2026-08-02 19:52'
updated_date: '2026-08-04 13:24'
labels:
  - 'size:S'
dependencies: []
priority: medium
ordinal: 401000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #1906 round-5 review named two follow-up-shaped items. (1) --limit has no upper bound — a typoed 500000 against prod fetches that many full diagnostic payloads and can trip the 128MB subprocess maxBuffer; sibling tts-configs caps at 200. (2) docs/reference/tooling/OPS_CLI_REFERENCE.md has no Cache Commands section at all, now covering FOUR commands (cache:inspect, cache:clear, cache:clear-credit-exhaustion, cache:prefix-diff).
Fix shape: add a generous cap (~100 pairs) with a clear error in commands/cache.ts, and write the Cache Commands section in one doc pass.
Acceptance: limit above the cap fails fast with a named error; all four cache commands documented.
<!-- SECTION:DESCRIPTION:END -->
