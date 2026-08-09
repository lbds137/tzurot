---
id: TASK-495
title: Pre-compaction context nudge hook - probe and build if light
status: To Do
assignee: []
created_date: '2026-08-09 19:38'
labels:
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 495000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner idea 2026-08-09 - long sessions hit compaction with volatile state (monitor ids, work-stack pointer) not yet written to CURRENT.md; a deterministic nudge beats remembering. Owner explicitly asked whether this would be too heavy-handed - keep it light or decline.
Fix shape: (1) probe what the harness exposes - is there a PreCompact hook event, and can a Stop/PostToolUse hook estimate context from transcript file size? Verify against current Claude Code docs, not memory. (2) If viable: a Stop-hook that stats the transcript and, past a byte threshold, emits ONE reminder per session (ack-file) to flush volatile state to CURRENT.md. Fail-open, no blocking.
Acceptance: either the hook ships with a probe per guard:hook-probes, or the task is closed with the probe result explaining why not (e.g. harness already handles it / no reliable signal).
<!-- SECTION:DESCRIPTION:END -->
