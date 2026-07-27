---
id: TASK-152
title: 'Standardize replyError test mocks to state-flipping deferReply'
status: To Do
assignee: []
created_date: '2026-06-19 00:00'
labels: []
dependencies: []
ordinal: 152000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Standardize `replyError` test mocks to state-flipping `deferReply`

**Why:** Four handler test factories (`character/view`, `persona/view`, `preset/create`, `memory/detail`) statically pre-set `deferred: true`, while `inspect/index` and `apikey/modal` flip `deferred` inside a `deferReply` `mockImplementation`. Both are correct today because every error path in those four handlers runs AFTER `deferReply` (no pre-defer/fresh path), so static-deferred accurately reflects the runtime ack state. **Latent trap**: if a future contributor adds a pre-defer (fresh) error path to one of those handlers, the static mock would silently exercise the deferred (`editReply`) branch while the real path is fresh (`reply`) — a green test for the wrong branch. **Fix shape**: convert the four factories to the state-flipping pattern (`deferReply = vi.fn().mockImplementation(() => { interaction.deferred = true; return Promise.resolve(); })`); ~4 factory edits, no behavior change. **Promote when**: next touching any of those four test files, OR adding a fresh (pre-defer) error path to any of those handlers. Surfaced 2026-06-19 by PR #1266 claude-review round 3 (nit, non-blocking). Deferred 2026-06-19.
<!-- SECTION:DESCRIPTION:END -->
