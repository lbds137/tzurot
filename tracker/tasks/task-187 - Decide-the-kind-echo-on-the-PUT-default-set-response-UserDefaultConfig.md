---
id: TASK-187
title: 'Decide the kind-echo on the PUT /default set response (UserDefaultConfig)'
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
labels:
  - 'area:bot-client'
  - 'area:common-types'
dependencies: []
ordinal: 187000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Decide the `kind`-echo on the `PUT /default` set response (`UserDefaultConfig`)

**Why:** `handleSetModelOverride` returns `{ override: { …, kind } }` but `handleSetDefaultModelConfig` returns `{ default: { configId, configName } }` — no `kind`. The caller always knows what slot it sent, so it's not a bug, but the asymmetry is more visible now both SET handlers accept `?kind=` (P3-S2). **Fix shape**: if bot-client (P3-S4) needs to confirm the written slot without threading it through call state, add `kind` to `UserDefaultConfig` (common-types) + populate it in the handler. **Promote when**: implementing P3-S4 — decide there based on whether the command flow needs the echo. Surfaced 2026-06-29 by PR #1385 (P3-S2) claude-review (non-blocking; tracked on task #60).
<!-- SECTION:DESCRIPTION:END -->
