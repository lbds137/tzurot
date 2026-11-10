---
id: TASK-1389
title: tracker-commit.test.ts real-git tests time out under machine load
status: To Do
assignee: []
created_date: '2026-11-10T14:24:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: high
ordinal: 1372000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: 14.8 s unloaded vs 144.8 s with 7 of 34 tests timing out at the 5 s default under load avg 60 (11-10 push). Setup spawns ~8 git processes per test; cleanGitEnv (tracker-commit.test.ts:761) keeps global git config, so temp repos inherit the global core.hooksPath dispatcher (cost unmeasured).
What: raise the real-git describe timeout (precedent payloadKeys.test.ts:12) and set GIT_CONFIG_GLOBAL=/dev/null + GIT_CONFIG_NOSYSTEM=1 in cleanGitEnv; measure unloaded time before/after.
Acceptance: file passes under load; PR states measured times (Fable perf review 2026-11-10, item P4).
<!-- SECTION:DESCRIPTION:END -->
