---
id: TASK-990
title: 'Guard env-example: cross-check the hand-rolled parser against dotenv.parse'
status: To Do
assignee: []
created_date: '2026-09-15 22:50'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 986000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2435 review round 3 (claude-review, low/informational). check-env-example.ts parses env files with its own regex plus quote tracking, while the app loads .env through the dotenv package (packages/tooling/src/cli.ts imports ./loadEnv.js, which calls dotenv config). Nothing pins the two to the same answer. If either env file ever adopts a dotenv feature the guard does not model — ${VAR} interpolation changing what counts as an assignment, or escaping rules that differ from containsClosingQuote — the guard silently diverges from what actually loads, and surfaces only as a confusing drift failure naming a key nobody edited. Fix shape: one test in check-env-example.test.ts that runs a shared fixture through BOTH parseEnvKeys and dotenv.parse and asserts the key sets match, covering the cases already in the suite (export prefix, inline comment, CRLF, multi-line quoted value, commented row). Note where they are EXPECTED to differ: dotenv has no notion of an export prefix or a commented-optional row, so the test asserts on the agreed subset and says why in a comment. Acceptance: the cross-check test exists and fails when parseEnvKeys is mutated to disagree with dotenv on the shared subset.
<!-- SECTION:DESCRIPTION:END -->
