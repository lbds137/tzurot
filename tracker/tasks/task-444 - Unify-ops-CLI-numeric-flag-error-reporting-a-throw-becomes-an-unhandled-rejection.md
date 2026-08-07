---
id: TASK-444
title: >-
  Unify ops CLI numeric-flag error reporting; a throw becomes an unhandled
  rejection
status: Done
assignee: []
created_date: '2026-08-06 02:04'
updated_date: '2026-08-07 00:59'
labels:
  - 'area:tooling'
  - 'size:M'
dependencies: []
priority: low
ordinal: 444000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Two conventions now coexist for CLI usage errors in packages/tooling. The throwing parseIntFlag is used by cache.ts, deploy.ts, dev.ts, prompt.ts, secrets.ts; the reporting parseIntFlagOrReport (prints + sets exitCode) is used by memory.ts and gh.ts.

Why it matters: cli.parse() discards the action promise and cli.ts registers NO unhandledRejection or uncaughtException handler (verified by grep). So a throw from the first group surfaces in a real pnpm ops run as a Node unhandled-rejection stack trace instead of the clean one-line usage error the second group prints. The process still exits nonzero, so this is UX, not correctness.

Pre-existing, not introduced by the parseIntFlag work — cache.ts already threw the same way for its required-channel guard. Surfaced by the #1985 round-4 review, which noted that PR extended the throw-based path to two more call sites.

Fix shape: pick ONE convention. Cheapest correct version is a top-level handler in cli.ts that renders a thrown Error as a one-line message plus exitCode 1, which makes the throwing form behave like the reporting form and lets parseIntFlagOrReport shrink to a thin adapter for the print-dont-throw files. Alternative is converting the five throwing files, which is more churn for the same result.

Acceptance: a malformed numeric flag on ANY ops command prints a single usage line naming the flag and exits nonzero, with no stack trace.

RUNTIME-CONFIRMED (not just code-read). `pnpm ops dev:stale-debug --max-age-days abc` produces:

    /home/deck/Projects/tzurot/packages/tooling/src/utils/cli-args.ts:82
        throw new Error(...)
              ^
    Error: --max-age-days must be an integer, got: "abc"
        at parseIntFlag (.../cli-args.ts:82:11)
        at CAC.<anonymous> (.../commands/dev.ts:122:21)
    Node.js v24.11.1

Exit code is 1, so the failure is correct and the message IS present — the defect is purely that it arrives wrapped in a stack trace and a Node version banner instead of as one line. That also confirms the fix is worth only the small version: a top-level handler that prints error.message and sets exitCode, not a rewrite of the call sites.
<!-- SECTION:DESCRIPTION:END -->
