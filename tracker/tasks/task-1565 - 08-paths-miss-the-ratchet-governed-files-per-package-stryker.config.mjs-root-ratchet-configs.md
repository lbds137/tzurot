---
id: TASK-1565
title: >-
  08 paths: miss the ratchet-governed files (per-package stryker.config.mjs,
  root ratchet configs)
status: To Do
assignee: []
created_date: '2026-11-27T04:26:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1558000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 08-tooling-internals.md loads only for tooling paths, but the files its ratchet constraints govern live elsewhere: packages/{cache-invalidation,clients,config-resolver,conversation-history,identity}/stryker.config.mjs plus .jscpd.json, knip.json, .dependency-cruiser.cjs. A session tuning a Stryker config to recover a red mutation score never loads "ignoreStatic stays OFF" or "never hand-edit the baseline" — a one-flag silent weakening of the mutation gate.

What: add packages/*/stryker.config.mjs, .jscpd.json, knip.json and .dependency-cruiser.cjs to the 08 paths: frontmatter; alternatively carry the ignoreStatic line in the always-loaded 00 baseline bullet. Root package.json and eslint.config.js deliberately excluded — they would load 08 on most dependency edits.

AC: a session editing a per-package stryker.config.mjs gets 08 loaded.

From PR #2822 round 9 finding 1 (carried under the process-residue default, reviewer-sanctioned).
<!-- SECTION:DESCRIPTION:END -->
