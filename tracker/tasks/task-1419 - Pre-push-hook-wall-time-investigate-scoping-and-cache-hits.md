---
id: TASK-1419
title: 'Pre-push hook wall time: investigate scoping and cache hits'
status: To Do
assignee: []
created_date: '2026-11-13T04:25:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1419000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lila 11-12: slow commit and push hooks should be investigated and ideally fixed. Measured on the beta.244 version-bump push (17 package.json version lines only): pre-push ran turbo build+lint+test across all 16 packages in 9m31s (LOW_RESOURCE_MODE on) and typecheck:spec then ran past the 10-minute mark - a code push to develop costs over 10 minutes of hook wall time before the push itself fires. Local turbo cache reported 0 of 43 tasks cached, so nothing is being reused between runs. Pre-commit (lint-staged: prettier + secretlint) is seconds and fine; the target is pre-push. Fix candidates to evaluate: (a) scope the pre-push pipeline to the packages the pushed commits touch (turbo --filter over the pushed range, or the focus: mechanism), (b) find why the local turbo cache never hits on pre-push (0 of 43) and fix or scope around it, (c) make LOW_RESOURCE_MODE actually reach turbo concurrency - see TASK-829. Constraint: scoping must cover every package the pushed commits touch; never weaken what the gate verifies. Acceptance: measured before/after wall time on a representative code push, materially down, or a documented reason it cannot shrink. Related: TASK-829 (LOW_RESOURCE_MODE vs turbo concurrency, OOM angle), TASK-675 (CI-side turbo cache twin).
<!-- SECTION:DESCRIPTION:END -->
