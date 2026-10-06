---
id: TASK-1186
title: >-
  guard:proposal-links counts gitignored docs/local files as inbound links, so
  it passes locally and fails in CI
status: To Do
assignee: []
created_date: '2026-10-06 02:52'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1176000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: check-proposal-orphans.ts walks the working tree with readdirSync, so a gitignored docs/local/ note that names a proposal satisfies the guard on the Deck while CI (no docs/local) reports the proposal orphaned. Observed: conversation-history-sync-unification.md, local pnpm quality green, PR #2581 lint red; the only inbound mention was docs/local/handoffs/ground-doc97p4-D-archaeology.md.
What: exclude docs/local/ from the scanned sources (or scan git ls-files only), with a test that a docs/local-only mention still reports the orphan.
Acceptance: the guard gives the same verdict locally and in CI.
<!-- SECTION:DESCRIPTION:END -->
