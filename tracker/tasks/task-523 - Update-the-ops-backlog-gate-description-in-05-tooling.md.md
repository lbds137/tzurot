---
id: TASK-523
title: Update the ops backlog gate description in 05-tooling.md
status: To Do
assignee: []
created_date: '2026-08-11 13:22'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 523000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2063 added two gated checks to pnpm ops backlog — relative-link resolution and doc-N cross-reference validation across tracker/docs, tracker/tasks and backlog. The command table in .claude/rules/05-tooling.md still describes the gate as "now.md caps + queue.md doc references + task-file integrity + open-task triage labels", so an always-loaded surface now understates what the gate enforces. Surfaced by the round-7 review.

Why not fixed in 2063: .claude/rules is review-gated (00-critical) and the Opus 5 orchestrator trial in the task-513 record carries an explicit no-rules-edits boundary. Same handling as TASK-520.

What: add the two checks to that line. Rides the next .claude/rules PR.

Acceptance: the 05-tooling.md description of pnpm ops backlog names every check the gate actually runs.
<!-- SECTION:DESCRIPTION:END -->
