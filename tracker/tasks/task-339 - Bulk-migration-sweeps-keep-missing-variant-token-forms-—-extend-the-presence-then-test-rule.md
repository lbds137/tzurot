---
id: TASK-339
title: >-
  Bulk-migration sweeps keep missing variant token forms — extend the
  presence-then-test rule
status: To Do
assignee: []
created_date: '2026-07-28 11:52'
labels:
  - 'area:process'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 339000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three instances across the substrate sessions of a "repo-wide" replacement sweep being narrower than claimed: #1823 missed services/ then *.yml; the step-4 migration missed bare "themes/" and "ideas.md" mentions (no cold/ prefix) that only surfaced via a file-view side channel. The class: sweeping for the canonical path form only, when references exist as bare basenames, prefixed variants, and backticked mentions.
Fix shape: one line in 10-working-posture.md § Presence-then-test: after a bulk rename/move, grep for the OLD token in its variant forms (bare basename, each prefix depth, backticked) before declaring the sweep complete — the canonical-form grep alone has now under-swept three times. Rules PR (review-gated).
<!-- SECTION:DESCRIPTION:END -->
