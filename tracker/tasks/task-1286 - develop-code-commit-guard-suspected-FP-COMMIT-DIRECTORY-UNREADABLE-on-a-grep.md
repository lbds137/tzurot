---
id: TASK-1286
title: 'develop-code-commit-guard suspected FP: COMMIT DIRECTORY UNREADABLE on a grep'
status: To Do
assignee: []
created_date: '2026-10-25 09:31'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1274000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mining window 10-18→10-25 flagged a suspected false positive: the guard reported COMMIT DIRECTORY UNREADABLE while the command was a grep. The guard evaluates the cwd/commit-dir before scanning; an unreadable-from-the-hook directory (or a cwd the hook cannot stat) should degrade gracefully, not block a read-only command. Build the probe fixture from the mined shape (miner report tzurot-2026-10-18_10-25-agent-report.md): if the live guard blocks the grep, add the probe row + the graceful-degrade fix; if it passes, document the shape. Fix rides upstream with the TASK-1242 retirement; probe locally either way. Size S. Labels: area:tooling,size:S,state:ready priority low
<!-- SECTION:DESCRIPTION:END -->
