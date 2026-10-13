---
id: TASK-607
title: No end-to-end test drives ops cli.ts parse-dispatch-error path
status: To Do
assignee: []
created_date: '2026-08-14 12:20'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 607000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: surfaced by the PR 2100 review. cli.ts turns a classifyNoMatch result into a UsageError and an exit code, and nothing tests that wiring end to end. `cli.test.ts` covers command registration and package.json metadata only — it never drives parse/dispatch/error. Both no-match branches are affected: the pre-existing `unknown` (bad command name) branch and the `unknown-flag` branch added by PR 2100. The pure functions underneath are thoroughly unit-tested; what is unverified is that cli.ts routes their results to the right exit code and stream.

This is the mocked-seam shape 02-code-standards.md names: the unit tests construct the classifier result themselves, so they cannot observe whether cli.ts forwarded it, threw the right error type, or wrote to the right stream. Today the only evidence is a manual invocation table pasted into a PR body, which no CI run re-derives.

Not folded into PR 2100 because it needs a harness that does not exist yet — driving the real CLI means spawning a process (or refactoring the top-level try/catch into an injectable entry point), which is a larger and separate design call than the one-line branch that surfaced it.

Fix shape: add a small spawn-based test that runs `npx tsx packages/tooling/src/cli.ts <argv>` for a handful of shapes and asserts exit code plus stderr content — bare (0, help), unknown command (nonzero, names it), unknown global flag (nonzero, names it), --help (0), --version (0). Keep the set small; this tier is slow and its value is the wiring, not coverage breadth. Alternatively extract the dispatch into a testable function and unit-test that, if spawning proves too slow for the tier.

Acceptance: deleting the `throw new UsageError(unknownFlagsMessage(...))` line in cli.ts turns a test red; same for the unknown-command line.
<!-- SECTION:DESCRIPTION:END -->
