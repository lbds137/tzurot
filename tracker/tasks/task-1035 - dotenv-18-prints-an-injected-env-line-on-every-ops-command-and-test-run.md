---
id: TASK-1035
title: dotenv 18 prints an injected-env line on every ops command and test run
status: Done
assignee: []
created_date: '2026-09-21 16:15'
updated_date: '2026-09-22 23:40'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1029000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the production-dependencies group bump (PR #2463, 2026-09-21) took dotenv from 17.4.2 to 18.0.0, whose changelog moves the injecting message to stderr and drops the tips. The result is a new line on every invocation: pnpm ops commands now print "injected env (16) from .env" before their own output (seen in the pnpm quality tail the same day), and the vitest runs print "injected env (5) from .env.test" as stderr from each services test setup (seen in the ai-worker suite output). Cosmetic, but it lands in every gate tail and every log an agent reads.
Fix shape: pass quiet to the three config() calls in services/*/src/test/setup.ts (dotenv supports config({ quiet: true })), and for the side-effect import in packages/tooling/src/cli.ts either set DOTENV_CONFIG_QUIET=true in the ops entrypoint or replace the import with an explicit config({ quiet: true }) call. Probe the option name against the installed dotenv (pnpm view dotenv@18 or the README in node_modules) before relying on it.
Acceptance: pnpm ops lines:check and pnpm --filter @tzurot/ai-worker test produce no injected-env line.
<!-- SECTION:DESCRIPTION:END -->
