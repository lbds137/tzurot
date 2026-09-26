---
id: TASK-1113
title: >-
  lines-check baseline-update test fails when FORCE_COLOR is set in the
  environment
status: To Do
assignee: []
created_date: '2026-09-26 03:59'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1106000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: packages/tooling/src/audits/lines-check.test.ts, test "prints all three delta shapes: new, shrunk, and grown" (describe runLinesUpdateBaseline CLI shell), asserts plain text such as 3 lines (-7) but never pins chalk.level, so chalk colours the delta and the toContain match fails. Observed 2026-09-25: the Claude Code shell exports FORCE_COLOR=3 and the pre-push hook failed on this test alone; with env -u FORCE_COLOR the file passes 37/37. The sibling --breakdown suite already pins chalk.level = 0 in its captureShell helper (same file, around line 773).
What: give the runLinesUpdateBaseline CLI shell describe the same chalk.level = 0 pin (capture helper or beforeEach/afterEach restoring the prior level). Sweep the other tooling tests that assert on chalk-formatted output for the same gap.
Acceptance: FORCE_COLOR=3 npx vitest run src/audits/lines-check.test.ts passes, with a canary showing the test reddens when the pin is removed under FORCE_COLOR=3.
<!-- SECTION:DESCRIPTION:END -->
