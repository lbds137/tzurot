---
id: TASK-199
title: 'Tune lint:complexity-report bare-run mode for the ops:health roster'
status: To Do
assignee: []
created_date: '2026-07-03 00:00'
updated_date: '2026-08-14 11:22'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 199000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tune lint:complexity-report bare-run mode for the ops:health roster

**Why (original, 2026-07-03):** a repo-wide run includes the deliberately-broken audit-canary fixture (complexity 25), so --summary structurally reports fail every time — 1507 findings on the maiden ops:health run.

**RE-VERIFIED 2026-08-14 — the premise has changed and the item is no longer size:S.** A bare `pnpm ops lint:complexity-report --summary` no longer over-reports; it CRASHES. The eslint child process dies with `FATAL ERROR: Ineffective mark-compacts near heap limit` at ~2050MB, so stdout is empty, and runEslint (complexity-report.ts:280) throws `Failed to parse ESLint JSON output`. The catch at :262 rescues a nonzero exit WITH stdout, which is the warnings-present case; an OOM-killed child has no stdout, so it falls through to an unparseable empty string. Full trace captured on the local Steam Deck; whether a GitHub runner survives it is UNVERIFIED — node picks its default heap from available memory, so a larger runner may or may not clear the same repo-wide load.

This means the roster addition is blocked behind a real fix, not a tuning knob. Two candidate shapes, neither costed yet: (a) run eslint per-package and merge the JSON results, bounding peak heap by the largest package rather than the repo; (b) raise the child heap via NODE_OPTIONS=--max-old-space-size on the execFileSync call, which is one line but only moves the ceiling. (a) is the more correct shape and is also what makes the tool usable on constrained machines.

Second, independent defect worth fixing alongside: an OOM-killed child is reported as a JSON parse error, which sent this investigation to the wrong layer. runEslint should distinguish empty stdout from malformed stdout and say so.

The canary-fixture exclusion from the original fix shape is still wanted, but it cannot be verified until the tool runs at all.

Acceptance: a bare repo-wide run completes on the local machine and emits a parseable summary; the canary suite still detects its fixture; only then does lint:complexity-report go back into HEALTH_TOOLS in audits/health.ts.
<!-- SECTION:DESCRIPTION:END -->
