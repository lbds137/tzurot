---
id: TASK-546
title: Bound or justify every remaining unbounded shell-out in packages/tooling
status: To Do
assignee: []
created_date: '2026-08-12 07:57'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 546000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-541 acceptance is unqualified — "no unbounded synchronous shell-out remains in packages/tooling ... or the ones left unbounded have a stated reason". PR 2072 bounded 11 sites (gate-reachable, session-context/state, and the two ci-gate stragglers) but roughly 20 files still have fully unbounded execFileSync/spawnSync calls with no stated reason. The PR 2072 round-4 review correctly flagged that closing TASK-541 against that bar would be an overclaim. This task owns the remainder so TASK-541 is not marked Done on an unmet acceptance.

Supersedes the archived TASK-544, which scoped only the release and deployment subset — narrower than the real remainder.

Remaining sites (from the review, verify before trusting): gh/github-api.ts ghApi (backs gh:pr-info, gh:pr-reviews, gh:pr-comments — the commands the PR-monitoring loop runs after every CI completion, so this is the highest-value one left); release/finalize.ts, release/premigrate.ts, release/publish.ts, release/github-prs.ts; deployment/logs.ts, deployment/setup-railway-variables.ts, secrets/rotation.ts (Railway CLI — network plus external service, likelier to hang than local git); audits/measured-ref.ts, test/tier-report.ts, test/generate-schema.ts, cache/prefix-diff.ts, utils/env-runner.ts, utils/gateway-client.ts, inspect/bullmqConnection.ts, inspect/tts-configs.ts, lint/complexity-report.ts, dev/update-deps.ts.

Why this is not a mechanical follow-on: the release and deployment scripts have no existing degrade path, and a release script arguably SHOULD fail loud rather than silently degrade. Several are interactive or legitimately long-running. Each site needs a decision: bound with a value matched to the work, leave unbounded with a stated-reason comment (the pattern used for the knip and turbo spawns), or restructure so failure is loud.

Precedent from 2072 on values: 15s for local git and grep probes, 60s for spawns that boot a CLI or open a DB connection, and a conditional bound where one branch is deliberately a long wait (runChecks bounds the report pass and leaves the watch pass unbounded). Value per site, not one global number.

READ THIS BEFORE BOUNDING ANYTHING — adding a timeout introduces a NEW failure mode into a catch that was written when timeouts were impossible. PR 2072 shipped exactly this bug twice and the review caught it on round 6. On a timeout kill Node still attaches whatever stdout was captured before the SIGTERM, so any catch that branches on stdout CONTENT reads that partial output as a real answer. getPendingMigrations went from hanging visibly to confidently reporting "no migrations pending" during a DB hang; hasNonTestImporters went from hanging to reporting a live file as a deletion candidate.

The check for every site in this task: does its catch inspect stdout, stderr, or an exit code to decide WHAT the answer is, rather than merely that it failed? If yes, guard the timeout first with isTimeoutKill from packages/tooling/src/utils/timeoutKill.ts and answer "unknown" — and pick the unknown value by which wrong answer is dangerous, not by which is convenient (null rather than empty-array, true rather than false).

Note the discriminator is error.code === ETIMEDOUT. It is NOT error.killed, which is undefined on that path — a killed guard type-checks, reads correctly, and silently never fires. Measured by probe; pinned by timeoutKill.test.ts, which drives a real bounded child rather than a synthetic fixture.

Acceptance: every execFileSync and spawnSync in packages/tooling either carries a timeout or carries a comment saying why it does not, AND every newly-bounded site whose catch is content-sensitive distinguishes the timeout — at which point TASK-541 can close honestly.
<!-- SECTION:DESCRIPTION:END -->
