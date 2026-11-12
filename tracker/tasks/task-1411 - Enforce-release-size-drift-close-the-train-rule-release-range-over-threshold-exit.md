---
id: TASK-1411
title: >-
  Enforce release-size drift: close-the-train rule + release:range
  over-threshold exit
status: To Do
assignee: []
created_date: '2026-11-12T22:06:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1401000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: beta.243 accumulated 32 PRs (21 runtime, 296 files) - past both cut backstops (~10 runtime, ~250 files) - and the release notes sat drafted from 13:30 while #2743 and #2744 landed onto the same train. The backstops print advisory text only; nothing closes the train. Owner ruled 2026-11-12: close-the-train rule, over a hard release-PR gate.

What: (1) a rule/skill line in /tzurot-git-workflow Release: once release notes are drafted, the release PR goes up in the same session and the train is closed - later PRs wait for the next train unless the owner explicitly waves one on. (2) release:range gains a machine-readable over-threshold exit code (non-zero when either backstop is crossed) so no session can claim it missed the flag.

Acceptance: the skill line is load-bearing in tzurot-git-workflow (PR-gated edit), release:range exits non-zero over threshold and documents the code, both land via normal PR flow.
<!-- SECTION:DESCRIPTION:END -->
