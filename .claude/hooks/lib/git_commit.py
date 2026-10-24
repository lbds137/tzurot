r"""The one shared "does this command invoke `git commit`" pattern.

Imported by both commit-blocking hooks (develop-code-commit-guard.sh,
board-commit-branch-gate.sh). The behavioral case table pinning
GIT_COMMIT_RE's verdicts lives in
packages/tooling/src/dev/gitCommitPattern.test.ts, which imports this module
through python3, so the tested object is the exact constant the hooks load.

Deliberate properties, each with the check that pins it:
- inline ``(?i)`` — uppercase GIT COMMIT must still be detected.
  ``re.ASCII`` is deliberately NOT set: it narrows ``\s``, and a
  non-breaking space between ``git`` and ``commit`` must still match.
  (Both pinned by case-table rows.)
- ``(?![-\w])`` after ``commit`` — the plumbing subcommands
  (``commit-tree``, ``commit-graph``) and ``commitfoo``/``commit_backup``
  are not commits. Python's ``\w`` is Unicode-aware, so the trailing
  ``(?![-\w])`` also rejects a non-ASCII suffix (``git commit日本語``).
  (Pinned by case-table rows.)
- the flag-consuming group before the subcommand accepts git global flags
  (``git -C x commit``, ``git --git-dir=y commit``). (Pinned by case-table
  rows.)
- the flag run ``-+[^-\s]\S*`` is DETERMINISTIC, deliberately without an
  atomic group: ``-{1,2}`` would make it re-partitionable (``--flag`` parses
  as ``--``+``flag`` or ``-``+``-flag``), so a failing match explores 2^n
  splits (measured: 20 double-dash flags 2.7 s, 60 no finish in 20 s).
  Requiring a non-dash after the dash run keeps 200 flags at 0.24 ms with
  every verdict unchanged. (Pinned by the timed ReDoS case in
  develop-code-commit-guard.probe.sh, not the case table — a table of
  verdicts cannot see a performance regression.) ``(?>...)`` would fix it
  too and is NOT used: atomic groups need Python 3.11+, and on anything
  older re.compile raises right here at import time, taking both hooks
  down — whose fail-open paths would then allow every commit. (Unverified
  by any automated check: CI runs 3.12, so nothing pins the 3.11 floor.)

Two consumer contracts sit on this file's exact shape, beyond the pattern's
meaning: board-commit-branch-gate.sh slices the literal 4-char ``(?i)``
prefix off ``GIT_COMMIT_RE.pattern`` to embed the body in its ``BYPASS_RE``
and fails open if the prefix changes, and board-commit-branch-gate.probe.sh's
sed canary rewrites ``(?i)`` to ``(?im)`` on the ``GIT_COMMIT_RE =`` line
and greps for the result, so the definition must stay on one line in this
spelling.
"""

import re

GIT_COMMIT_RE = re.compile(r"(?i)\bgit(?:\s+-+[^-\s]\S*(?:\s+[^-\s]\S*)?)*\s+commit(?![-\w])")
