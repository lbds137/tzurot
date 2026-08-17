---
id: TASK-643
title: >-
  cache:prefix-diff cannot select by cache depth, so it cannot find its own
  subject
status: To Do
assignee: []
created_date: '2026-08-17 19:11'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 643000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-641 asked where the prefix diverges on SHALLOW-HIT requests. The tool selects rows by --channel/--personality only, so a session sampled two channels, drew healthy conversations both times, and twice wrote an incorrect conclusion into doc-17 before the sampling error was spotted. With a ~48 percent miss rate spread across many channels, drawing healthy threads is the likely outcome, not bad luck. The instrument cannot find the population it exists to diagnose.

What resolved it: a scratch prod query selecting rows where cachedPromptTokens/promptTokens < 0.25 across ALL channels, then running the existing tool on the channels that surfaced. The answer was then visible immediately (cached tokens constant per channel while prompt length varies). Evidence in doc-17 section TASK-641 CLOSED.

Fix shape: add a depth selector, e.g. --max-depth <ratio>, that scans recent rows across all channels, groups by channel, and diffs each qualifying row against its predecessor. Payload paths for the ratio are llmResponse.promptTokens and llmResponse.cachedPromptTokens at the TOP level of llmResponse, NOT nested under usage: a guessed usage path returned 0 of 202 rows. Registered command lives in packages/tooling/src/commands/cache.ts, logic in packages/tooling/src/cache/prefix-diff.ts.

Acceptance: pnpm ops cache:prefix-diff --env prod --max-depth 0.25 surfaces shallow-hit channels and diffs them, with no separate prod query needed; unit tests cover the depth filter including rows with a missing or zero cached value.
<!-- SECTION:DESCRIPTION:END -->
