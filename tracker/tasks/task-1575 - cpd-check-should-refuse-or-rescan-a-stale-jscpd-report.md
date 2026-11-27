---
id: TASK-1575
title: cpd:check should refuse or rescan a stale jscpd report
status: To Do
assignee: []
created_date: '2026-11-27T20:51:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1565000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: observed 11-27 on PR 2829 round 1 - the local cpd:check consumed a stale reports/jscpd/jscpd-report.json (from 14:45, zero references to the new DoomMarkCache) and reported the pre-fix tree at 1679 while the same content measured 1653 on a fresh pnpm cpd scan; one wasted gate run before the trap was diagnosed. CI is unaffected: a fresh runner has no report file, so cpd:check there scans for real. What: make cpd:check detect report staleness (report mtime vs newest scanned source file, or a git-head stamp written at scan time) and either rescan or refuse with the rescan instruction. Acceptance: a deliberately stale report makes cpd:check rescan or refuse with a clear message; a fresh report passes unchanged; tooling tests green.
<!-- SECTION:DESCRIPTION:END -->
