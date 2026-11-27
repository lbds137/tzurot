---
id: TASK-1554
title: Dev tooling raw OpenRouter calls bypass the provider routing pin
status: Done
assignee: []
created_date: '2026-11-25T20:52:00Z'
updated_date: '2026-11-27T17:19:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1549000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/memory/render-pilot-provider.ts makes raw OpenRouter chat calls outside ModelFactory, so the TASK-1261 routing (data_collection deny, forwarder ignore list, per-model allowlist) does not apply to them. Medium, not low: the pilot renders memory content through OpenRouter (OPENROUTER_CHAT_URL at :19), which is the data-rights surface TASK-1261 exists to close; whether its inputs are real user memories or fixtures is not checked yet, and checking it is step one.

What: import the routing resolver (or the common-types OPENROUTER_ROUTING constants) and send the same provider object from the tooling call path.

Acceptance: a test asserts the provider object in the tooling request body.

Also (PR #2816 round-4 review, owner placed it here): add a recurring tooling or `ops health` check that diffs the `OPENROUTER_ROUTING.PINNED_MODELS` host slugs against OpenRouter `/models/{id}/endpoints`, so a renamed or retired slug is caught before it shrinks the `only` set into a `ROUTING_EXHAUSTED` that looks like an outage. The existing routing tests check count, uniqueness and no overlap with the ignore list, not liveness.

Blocked on: the TASK-1261 routing PR landing the constants.
<!-- SECTION:DESCRIPTION:END -->
