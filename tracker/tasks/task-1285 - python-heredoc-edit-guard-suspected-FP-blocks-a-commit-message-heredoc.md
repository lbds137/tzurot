---
id: TASK-1285
title: 'python-heredoc-edit-guard suspected FP: blocks a commit-message heredoc'
status: To Do
assignee: []
created_date: '2026-10-25 09:31'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1273000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mining window 10-18→10-25 flagged a suspected false positive: the guard tripped on a COMMIT-MESSAGE heredoc (a git commit -m "$(cat <<'EOF' ...)" shape), which is not a python write. Build the discriminating probe fixture: run the live guard against the exact shape from the mined window (pull the command from the miner report tzurot-2026-10-18_10-25-agent-report.md) — if it blocks, add the probe row + narrow the guard; if it passes, record the shape as documented in the probe. The guard is dual-homed (.claude/hooks copy + seyag plugin); the fix rides upstream with the TASK-1242 retirement — probe locally either way. Size S. Labels: area:tooling,size:S,state:ready priority low
<!-- SECTION:DESCRIPTION:END -->
