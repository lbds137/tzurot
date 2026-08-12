---
id: TASK-541
title: Bound the remaining unbounded execFileSync shell-outs in packages/tooling
status: To Do
assignee: []
created_date: '2026-08-12 04:35'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 541000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2069 added a 15s timeout to readTrackerGitStatus after review pointed out that a synchronous git call inside pnpm quality and the pre-push hook blocks the gate outright if it stalls, rather than degrading. The same shape is still unbounded in three siblings: readOriginTaskFiles (backlogLint.ts, a git ls-tree), and the two private execFileSafe helpers in context/session-context.ts and context/session-state.ts. All three run in the same hook/quality paths.

What: add a timeout to each, matching the house value (ci-gate.ts uses an exported 15_000 constant with a stated degrade-not-hang rationale; trackerGitStatus.ts now has TRACKER_STATUS_TIMEOUT_MS). Each already has a try/catch that treats failure as a normal answer, so a timeout throw lands in the existing degradation path and needs no new branch — assert the option in each colocated test the way trackerGitStatus.test.ts does.

Also consider, but do not force: the three execFileSafe-shaped helpers are now four counting readTrackerGitStatus. A shared wrapper was deliberately declined in 2069 because the call sites need different options (encoding, stdio, extra flags) and 02-code-standards prefers duplication over the wrong abstraction. If a fifth appears, revisit.

Acceptance: no unbounded synchronous shell-out remains in packages/tooling, each bound is asserted by a test, or the ones left unbounded have a stated reason.
<!-- SECTION:DESCRIPTION:END -->
