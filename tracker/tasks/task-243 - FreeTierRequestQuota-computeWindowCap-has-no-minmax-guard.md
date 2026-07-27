---
id: TASK-243
title: 'FreeTierRequestQuota computeWindowCap has no min<=max guard'
status: To Do
assignee: []
created_date: '2026-07-08 00:00'
labels: []
dependencies: []
ordinal: 243000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

FreeTierRequestQuota computeWindowCap has no min<=max guard — If `FREE_TIER_MIN_PER_WINDOW > FREE_TIER_MAX_PER_WINDOW` were ever misconfigured, `clamp` silently collapses to a fixed `min` regardless of contention (the dynamic behavior disappears). The promote-when trigger FIRED (knobs became admin-tunable, admin-runtime PR 1): the system-settings WRITE surface now enforces min<=max on the merged bag (#1605 `validateWindowPair`). Residual: the env path stays unguarded until env deletion (admin-runtime consumer-swap slice), and `computeWindowCap` itself still has no runtime assert. **Fix shape**: a one-line swap-if-inverted (or assert) in `computeWindowCap` as defense-in-depth. **Promote when**: the consumer-swap slice touches the quota provider fns anyway.

**Why:** Config-sanity guard; write-surface half shipped. Surfaced 2026-07-08 (dated from git history).
<!-- SECTION:DESCRIPTION:END -->
