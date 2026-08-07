---
id: TASK-457
title: An unknown GLOBAL flag on a bare ops invocation prints help and exits 0
status: To Do
assignee: []
created_date: '2026-08-07 02:32'
updated_date: '2026-08-07 12:33'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 456000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sibling of TASK-454, which closed the unknown-COMMAND hole. `pnpm ops --bogus-flag` (no command name) still prints help and exits 0, so a flag typo is indistinguishable from success — the same defect class, reached by a different path.

Mechanism: cac validates unknown options only against a MATCHED command (checkUnknownOptions throws CACError there). With no command name, parsing falls to the global command, which has no option allowlist beyond -h/-v, so nothing rejects the flag. classifyNoMatch then sees an empty args[0] and correctly routes to help — correct for a genuinely bare `pnpm ops`, wrong when unrecognized flags are present.

Surfaced by the PR 1993 post-autosquash review, which scoped it out of that PR as not-a-regression. That is an origin claim, not a verdict: the defect is real, it is just narrow.

Design question to settle first, which is why this is filed rather than folded into 1993: what counts as a valid global flag? Today only -h/--help and -v/--version are registered. Erroring on anything else is easy but needs a decision about whether future global flags must register themselves, and about the bare `pnpm ops --` edge.

Fix shape: in classifyNoMatch, when no command name is present AND options contains a key that is not help/version, return an unknown-flag action rather than help. Reuse the UsageError path so the shape matches every other operator error.

Acceptance: `pnpm ops --bogus-flag` prints one line naming the flag and exits nonzero; bare `pnpm ops` still prints help and exits 0; `pnpm ops --help` unchanged.
<!-- SECTION:DESCRIPTION:END -->
