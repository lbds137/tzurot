---
id: TASK-118
title: Validate audit.config reviewedAt as ISO date
status: Done
assignee: []
created_date: '2026-05-21 00:00'
updated_date: '2026-07-30 00:57'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 118000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Validate `audit.config` `reviewedAt` as ISO date

**Why:** `packages/tooling/src/dev/schema-audit-suppression.ts` `assertConfigShape` accepts any string for the optional `reviewedAt` field. The intent is a human-accountability / staleness audit timestamp, so values like `"last tuesday"` or typos pass silently. **Fix shape**: when `e.reviewedAt` is present, check `/^\d{4}-\d{2}-\d{2}/.test(e.reviewedAt)` (or `Date.parse` not NaN) and throw on failure. ~3 LOC. **Why deferred**: tool is one-shot / quarterly; bad timestamps are aesthetic, not load-bearing. Promote when adding a staleness-check pass that compares `reviewedAt` ages against a freshness budget (would require parseable dates). Surfaced 2026-05-21 by PR #1076 round-6 claude-bot review. Deferred 2026-05-21.
<!-- SECTION:DESCRIPTION:END -->
