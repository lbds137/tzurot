---
id: TASK-143
title: Time-based audit for stale debug commits left on develop
status: Done
assignee: []
created_date: '2026-06-08 00:00'
updated_date: '2026-07-29 18:14'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Time-based audit for stale `debug` commits left on develop

**Why:** The `debug` commit type (PR #1179) relies on a manual `git log --grep '^debug[:(]'` to catch instrumentation added but never removed — advisory, not enforced. A merge-time gate (claude-review's Medium-2 suggestion, mirroring `fixup-check`) is the WRONG remedy: `debug` commits are _supposed_ to merge temporarily, so a gate can't distinguish intentional-temporary from forgotten — both look identical at merge. **Fix shape**: a periodic audit-class tool (fits the `pnpm ops` audit framework — measurement + threshold + periodic) that flags `debug` commits on develop older than N releases/days; that's the "you forgot to remove this" signal a merge gate structurally cannot give. **Promote when**: `debug` commits start accumulating on develop (the convention sees real use and a stale one is observed or missed). Surfaced by PR #1179 claude-review Medium-2; reframed from the rejected merge-gate remedy. Deferred 2026-06-08.
<!-- SECTION:DESCRIPTION:END -->
