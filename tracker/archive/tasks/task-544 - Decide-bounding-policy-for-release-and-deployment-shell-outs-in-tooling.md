---
id: TASK-544
title: Decide bounding policy for release and deployment shell-outs in tooling
status: To Do
assignee: []
created_date: '2026-08-12 07:16'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 544000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-541 bounded the tooling shell-outs that sit in hook/quality paths and already had a catch-and-degrade shape. Several dozen execFileSync sites remain unbounded elsewhere in packages/tooling — release/publish.ts, release/finalize.ts, release/premigrate.ts, deployment/logs.ts, parts of gh/ci-gate.ts, gh/github-api.ts, audits/, secrets/rotation.ts. Surfaced by the PR 2072 review as an Info finding, correctly noting that TASK-541 acceptance line ("no unbounded synchronous shell-out remains in packages/tooling") is not literally satisfied.

Why this is NOT a mechanical follow-on: those are one-shot release and deployment scripts with no existing degrade path. A release script arguably SHOULD fail loud rather than silently degrade, and several of them are interactive or legitimately long-running (a deploy, a publish, a log pull). Bounding them means deciding, per site, what a timeout should DO — which is a design question, not the one-line option add that TASK-541 was.

What: enumerate the remaining sites deterministically (grep execFileSync across packages/tooling/src excluding the ones TASK-541 bounded), and for each decide one of: bound with a value matched to the work, leave unbounded with a stated-reason comment (the pattern used for the knip spawn and the turbo spawn), or restructure so failure is loud. Record the decision at each site so the next sweep does not re-litigate it.

Note a precedent already set in 2072: the prisma migrate status call got its own 60s constant rather than the 15s git value, because it spawns npx and opens a DB connection. Value-per-site, not one global number.

Acceptance: every execFileSync in packages/tooling either carries a timeout or carries a comment saying why it does not.
<!-- SECTION:DESCRIPTION:END -->
