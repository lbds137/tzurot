---
id: TASK-495
title: Pre-compaction context nudge hook - probe and build if light
status: Done
assignee: []
created_date: '2026-08-09 19:38'
updated_date: '2026-09-03 23:46'
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

### 2026-09-03 — CLOSED: shipped as context-size-reminder.sh

The probe-half of the fix shape resolved as: no PreCompact event, but a UserPromptSubmit hook can read the transcript tail. `.claude/hooks/context-size-reminder.sh` is that hook — past a 500k-token threshold it emits one reminder per 30-minute window to name the next compaction boundary, fail-open, probed under `guard:hook-probes`. Acceptance clause (a) is met by that file. PR #2320 adds the post-compaction silence it needed.
<!-- SECTION:DESCRIPTION:END -->
