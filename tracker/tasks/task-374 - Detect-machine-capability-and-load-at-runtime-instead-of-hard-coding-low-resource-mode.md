---
id: TASK-374
title: >-
  Detect machine capability and load at runtime instead of hard-coding
  low-resource mode
status: To Do
assignee: []
created_date: '2026-07-31 01:50'
updated_date: '2026-08-04 13:56'
labels:
  - 'size:M'
  - 'area:tooling'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 374000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner-requested, low priority side project: "instead of hard coding in the repo instructions to manage low resource mode for my Steam Deck, we should have tooling that determines system load and inherent capabilities."

Why: today the constraint lives as prose in .claude/rules/05-tooling.md (never run pnpm test and pnpm quality in parallel; never run test:integration locally) plus a manual LOW_RESOURCE_MODE=1 env flag. Prose is advisory — it depends on the agent remembering, and it is wrong on any machine that is NOT the Steam Deck, which makes it a portability tax as well as a reliability one. It also cannot react to the actual state of the box: the same command is fine on an idle machine and an OOM kill with a browser and the IDE open.

What: a small ops helper that reads inherent capability (core count, total RAM) and current load (available RAM, load average) and derives the knobs the heavy commands need - vitest maxWorkers/pool, whether a chained run must serialize, whether to refuse a known-OOM command outright. Consumed by the test/quality scripts so the decision is made from measurement rather than from a rule the reader has to recall.

Acceptance: heavy commands pick their own concurrency from measured capability; LOW_RESOURCE_MODE becomes an override rather than the mechanism; the Steam-Deck-specific prose in 05-tooling.md shrinks to a pointer at the tool.

Note: low priority and explicitly a side project - do not let it preempt product work.
<!-- SECTION:DESCRIPTION:END -->
