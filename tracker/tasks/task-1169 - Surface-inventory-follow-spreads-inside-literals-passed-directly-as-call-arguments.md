---
id: TASK-1169
title: >-
  Surface inventory: direct call arguments - follow literal spreads and unwrap
  as/satisfies/parens/non-null
status: To Do
assignee: []
created_date: '2026-10-04 20:47'
updated_date: '2026-10-04 21:33'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1161000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the discord.js surface inventory (packages/tooling/src/surface/analyzer.ts collectOptionKeys, ObjectLiteral branch -> literalKeys) records only the literal's own keys, so `reply({ content, ...rest })` silently drops the keys `rest` carries. The return path (returnedLiteralKeys) already follows such spreads, resolving a literal-initialized local or recording the `*` marker, so the two paths disagree and the direct one is the silent-gap class PR #2571 closed elsewhere.

What: measure first (count direct-argument literals with a SpreadAssignment in bot-client), then route the ObjectLiteral branch through returnedLiteralKeys. This changes the existing analyzer.test.ts fixture assertion that spread keys are not key sites, so it is a spec change: state the new semantics in the PR.

Second member (PR #2571 round-7 review): collectOptionKeys does not unwrap a direct argument wrapped in parentheses, `as`, `satisfies` or `!`, while collectReturnedKeys treats all four as transparent. So `send({ content } as WebhookMessageCreateOptions)` records only `*` (the asserted named type) instead of `content`, and `send((options))` skips initializer tracking. Never silent, only imprecise. A single-line git grep over bot-client src found no such call site today, so it is latent; multi-line casts were not searched. Fix: unwrap the same four wrappers at the top of collectOptionKeys.

Acceptance: a direct-literal spread of a literal-initialized local records that local's keys, an unresolvable spread records `*`, a wrapped direct argument resolves like its unwrapped form, snapshot regenerated, doc-109 TR-9.1 counts updated.
<!-- SECTION:DESCRIPTION:END -->
