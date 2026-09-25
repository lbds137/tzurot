---
id: TASK-1107
title: >-
  guard:prompt-tags scanner: drop } from the regex trigger set and sweep the
  round-6 heuristic edges
status: To Do
assignee: []
created_date: '2026-09-25 18:28'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1100000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 6 on PR #2537 (the string-aware scanner) traced that } in REGEX_PRECEDERS is ambiguous the same way ) is: after an object literal, a following slash is division, so const r = {x: 1} / <quoted tag> / 2; reads the slash as a regex start and swallows the string literal (and any tag in it) as regex content, the silent false-negative class the PR closed elsewhere. Narrow trigger (two same-line slashes after an object-literal close brace), hand-traced by the reviewer and not runtime-confirmed; the PR merged at the six-round cap on the owner ruling rather than iterate again inline.

Fix shape: in packages/tooling/src/dev/check-prompt-tags.ts, remove } from REGEX_PRECEDERS (a block-closing } followed on the same line by a regex statement is rarer than an object literal followed by division; the newline rule still covers the next-line case) and pin it with a test that {x: 1} / <quoted tag> / 2 keeps the tag; add a test that an identifier ending in lowercase return (customreturn / x) is read as division; mention in the scanSource JSDoc blind spots that the colon-preceded // keep (URL parity) also keeps a comment after a case label or object key, and that \r is not a line terminator for the scanner.

Acceptance: the four items each have a test or a JSDoc line; the real-tree guard test stays green; pnpm ops guard:prompt-tags green.
<!-- SECTION:DESCRIPTION:END -->
