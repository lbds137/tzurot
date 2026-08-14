---
id: TASK-606
title: A stray positional after -- still exits 0 on a bare ops invocation
status: To Do
assignee: []
created_date: '2026-08-14 12:10'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 606000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: third path in the same family as TASK-454 (unknown command) and TASK-457 (unknown global flag), surfaced by the PR 2100 review and confirmed by probe: `pnpm ops -- foo` prints help and exits 0. cac routes positionals after the literal -- separator into the options object under the "--" key rather than into args, so args[0] is undefined and classifyNoMatch correctly returns help; findUnknownFlags deliberately skips the "--" key because it is present on every invocation, including a genuinely bare one.

So a mistyped `pnpm ops -- db:status` silently succeeds while `pnpm ops db:status` runs. Narrow, and lower-value than its two siblings — nobody types -- by accident as often as they typo a flag — which is why it was not folded into PR 2100.

Fix shape: in classifyNoMatch, when there is no command name and no unrecognized flags, treat a NON-EMPTY options["--"] array as an unknown-command-shaped error naming its first element, rather than falling through to help. Bare `pnpm ops` and `pnpm ops --` both leave that array empty, so they keep printing help and exiting 0 — pin both in tests, since an empty-vs-absent mistake here re-breaks the bare invocation.

Acceptance: `pnpm ops -- foo` exits nonzero naming foo; `pnpm ops` and `pnpm ops --` still print help and exit 0; `pnpm ops db:status -- foo` unchanged (a matched command owns its own trailing args).
<!-- SECTION:DESCRIPTION:END -->
