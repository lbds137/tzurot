---
id: TASK-479
title: >-
  A command substitution nested inside quotes is erased by strip_quoted,
  bypassing the blocking commit guard
status: Done
assignee: []
created_date: '2026-08-09 10:37'
updated_date: '2026-08-09 14:21'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 479000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
MEASURED, not traced. bash executes the inner command in all three forms (probe printed RAN); strip_quoted returns "echo S" for the quoted forms, so the invocation is gone and develop-code-commit-guard exits 0.

  echo "$(git commit -m x)"     -> echo S     detected=False
  echo "`git commit -m x`"      -> echo S     detected=False
  echo $(git commit -m x)       -> intact     detected=True   (unquoted is fine)

Why the existing fail-safe does not catch it: the docstring relies on an unterminated quote returning None so the caller over-arms on raw text. Here the quote count is EVEN — a well-formed substitution is a syntactic requirement for valid bash — so the scan closes cleanly and returns a successfully-stripped string with the target erased. The safe direction is never reached.

Severity: this is the guard named in the post-mortem table, whose entire job is stopping unreviewed code landing on develop. The trigger needs no adversarial intent — wrapping a captured commit result in a status echo is an ordinary shape.

Pre-existing: the two-pass re.sub it replaced consumed the same span identically, so this predates the shared scanner. It is filed against the scanner because that is now the one place to fix it for all three consumers.

Fix shape: the flat state machine has no notion of nesting. Inside a double-quoted span, on encountering $( or a backtick, find the matching close by paren depth, recursively strip that interior, and EMIT the result rather than swallowing it — bash treats a substitution as its own parsing context, so its content belongs at top level. lossy-pipe-guard has the same root cause for rule 1; cwd-drift-guard too at advisory stakes.

Why not fixed in the PR that surfaced it: recursive substitution handling is a distinct structural change to a scanner with three consumers, one of them blocking, and that PR had already produced three regressions in adjacent code that each cost a review round to find. Bundling a fourth structural change into round 12 is how a fifth happens. It also does not worsen anything by shipping — the bypass predates the PR.

Acceptance: the two quoted forms above are detected; the unquoted control still is; a probe case and a strip_quoted unit case pin all three.
<!-- SECTION:DESCRIPTION:END -->
