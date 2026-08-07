---
id: TASK-452
title: >-
  Harden the CI-monitor run-gate: named-workflow assumption, silent gh api
  failure, startup_failure wait
status: Done
assignee: []
created_date: '2026-08-07 00:51'
updated_date: '2026-08-07 03:28'
labels:
  - 'area:process'
  - 'area:tooling'
  - 'size:M'
dependencies: []
priority: medium
ordinal: 451000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Three findings from the #1989 round-4 review. None block what shipped (the run-gate is a large net improvement over the fixed sleep it replaced, which demonstrably fired false CI_COMPLETE twice on 2026-08-06), but all three are real.

1. [High] The gate names the "CI" workflow specifically and assumes it always outlasts every other check. That rests on ONE measurement from one docs-only push, not on any mechanism. If a slower check has not registered as a check-run when the CI run completes, the handoff to gh pr checks --watch starts against a partial list and exits early — the exact premature-CI_COMPLETE bug the gate was built to eliminate, just triggered by a different slow check.

   Verification attempted 2026-08-06 and INCONCLUSIVE, record it honestly: two CodeQL workflows are registered active, but zero CodeQL runs appear in the last 100 actions/runs, and CodeQL appears in the check list of NEITHER PR 1989 nor 1990 (22 checks each, no CodeQL entry). So the reviewer claim that CodeQL is invisible to the polled query could not be confirmed OR refuted. Note the practical consequence: if CodeQL never registers as a check-run on a given PR, --watch is not waiting on it either, so there is nothing to miss. The risk is specifically a PR where CodeQL DOES register and registers slowly — real, but unobserved.

   Fix shapes to consider: gate on "no workflow run for this SHA is non-terminal" instead of naming CI (covers claude-review and any future workflow, though not GitHub-native default-setup scanning if that truly is invisible); or add a secondary re-arm/sanity pass after the reported CI_COMPLETE.

2. [Medium] The gate loop is SILENT on gh api failure for up to the full 30-minute timeout. On an auth problem, rate limit, or transient network error, jq gets no valid JSON, grep matches nothing, and the loop just sleeps and retries with zero output to the event stream. This is exactly the anti-pattern the Monitor tool guidance names: "silence is not success — if this process crashed right now, would my filter emit anything?" The previous sleep-based command did not have this failure mode to the same degree, because a broken gh environment made --watch itself error out quickly. THIS IS THE ONE MOST WORTH FIXING: a silent 30-minute gate is a worse failure mode than a loud one, and it is indistinguishable from "CI is just slow".

   Fix shape: echo the raw gh api stderr on failure, or emit a heartbeat every few minutes so a broken gate is visibly different from a healthy slow one.

3. [Low] conclusion=="startup_failure" is excluded from the positive match so the gate does not release early on a died-before-dispatch run. Correct, but it means such a run falls all the way through to the full timeout even though startup_failure is a fully-resolved terminal state the moment it appears. The gate could detect it specifically and emit an early distinguishable signal instead of burning 30 minutes of wall-clock.

All three live in the same one-liner, which is currently hand-synced across three surfaces — so doing this work pairs naturally with TASK-451 (single source of truth for the canonical command). Doing 451 first would make these three a one-place edit instead of three.

Acceptance: a broken gate is visibly distinguishable from a slow one within a few minutes; the gate does not depend on an unverified assumption about which workflow finishes last.
<!-- SECTION:DESCRIPTION:END -->
