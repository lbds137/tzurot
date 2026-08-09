---
id: TASK-476
title: Release step 9 (CURRENT.md reset) has no gate and was skipped for beta.196
status: To Do
assignee: []
created_date: '2026-08-09 08:07'
updated_date: '2026-08-09 08:08'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 476000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: beta.196 was cut (52e0b01c6) with no "reset CURRENT.md" commit. The last such commit is edbfa2b93, for beta.195. Nothing caught it.

Consequence, measured: CURRENT.md still declares "Version: v3.0.0-beta.195" and carries two releases of content. That is 37475 of its 39237 byte budget (95.5%), leaving ~1762 bytes — about 4.6 lines at this file always-loaded density of 382 B/line. The next session to add a smoke checklist breaches the ratchet, and the breach will read as a budget problem rather than as a missed release step.

Fix shape: a mechanical preflight assertion. The version header in CURRENT.md must equal package.json version. It is a string comparison over two files, deterministic, with no judgment in it, and it fails exactly when step 9 was skipped. Natural homes: the release preflight beside guard:repo-settings, or a lines:check-adjacent guard.

Note the reset ITSELF stays human judgment (deciding what outlives a release); only the "did it happen" check is mechanical. Do not try to automate the trim.

Acceptance: cutting a release without resetting CURRENT.md fails a check before the release PR merges.
<!-- SECTION:DESCRIPTION:END -->
