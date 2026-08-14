---
id: TASK-606
title: >-
  classifyNoMatch under-reports: stray -- positional exits 0, and a bad flag
  beside a bad command is silent
status: To Do
assignee: []
created_date: '2026-08-14 12:10'
updated_date: '2026-08-14 12:29'
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
Two gaps in the same function (packages/tooling/src/utils/unknown-command.ts, classifyNoMatch), both surfaced by the PR 2100 review and both confirmed by probe. Same file, same pass — filed together rather than fragmented.

**(a) A stray positional after -- exits 0.** `pnpm ops -- foo` prints help and exits 0. cac routes positionals after the literal -- separator into the options object under the "--" key rather than into args, so args[0] is undefined and classifyNoMatch returns help; findUnknownFlags deliberately skips the "--" key because it is present on every invocation, including a genuinely bare one. So a mistyped `pnpm ops -- db:status` silently succeeds while `pnpm ops db:status` runs.

**(b) An unknown flag beside an unknown command is not mentioned.** `pnpm ops --bogus-flag no-such-command` reports only Unknown command "no-such-command"; the flag typo goes unreported, because findUnknownFlags is only consulted inside the no-command-name branch. Not a regression — pre-PR behavior for that input was the same single error — and outside TASK-457 acceptance, which scoped to no-command-name cases.

Both are third and fourth paths in the family TASK-454 and TASK-457 opened, and neither is urgent: nobody types -- by accident often, and (b) still fails loudly with a correct, if incomplete, message.

Fix shape for (a): when there is no command name and no unrecognized flags, treat a NON-EMPTY options["--"] array as an unknown-command-shaped error naming its first element rather than falling through to help. Bare `pnpm ops` and `pnpm ops --` both leave that array empty, so they keep printing help and exiting 0 — pin both in tests, since an empty-vs-absent mistake here re-breaks the bare invocation.

Fix shape for (b): compute unknown flags regardless of branch and fold them into the unknown-command message when both are present. Keep the single-problem messages byte-identical when only one applies, so existing tests stay meaningful.

Acceptance: `pnpm ops -- foo` exits nonzero naming foo; `pnpm ops --bogus-flag no-such-command` names BOTH problems; `pnpm ops`, `pnpm ops --`, and `pnpm ops db:status -- foo` are all unchanged.
<!-- SECTION:DESCRIPTION:END -->
