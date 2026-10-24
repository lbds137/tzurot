r"""The one shared "does this command invoke `git commit`" pattern.

Imported by both commit-blocking hooks (develop-code-commit-guard.sh,
board-commit-branch-gate.sh). The behavioral case table pinning
GIT_COMMIT_RE's verdicts lives in
packages/tooling/src/dev/gitCommitPattern.test.ts, which imports this module
through python3, so the tested object is the exact constant the hooks load.

Deliberate properties, each pinned by a case-table row there:
- inline ``(?i)`` — uppercase GIT COMMIT must still be detected.
  ``re.ASCII`` is deliberately NOT set: it narrows ``\s``, and a
  non-breaking space between ``git`` and ``commit`` must still match.
- ``(?![-\w])`` after ``commit`` — the plumbing subcommands
  (``commit-tree``, ``commit-graph``) and ``commitfoo``/``commit_backup``
  are not commits. Python's ``\w`` is Unicode-aware, so the trailing
  ``(?![-\w])`` also rejects a non-ASCII suffix (``git commit日本語``).
- the flag-consuming group before the subcommand accepts git global flags
  (``git -C x commit``, ``git --git-dir=y commit``).
- the flag run ``-+[^-\s]\S*`` is DETERMINISTIC, deliberately without an
  atomic group: ``-{1,2}`` would make it re-partitionable (``--flag`` parses
  as ``--``+``flag`` or ``-``+``-flag``), so a failing match explores 2^n
  splits (measured: 20 double-dash flags 2.7 s, 60 no finish in 20 s).
  Requiring a non-dash after the dash run keeps 200 flags at 0.24 ms with
  every verdict unchanged. ``(?>...)`` would fix it too and is NOT used:
  atomic groups need Python 3.11+, and on anything older re.compile raises
  right here at import time, taking both hooks down — whose fail-open paths
  would then allow every commit.
"""

import re

GIT_COMMIT_RE = re.compile(r"(?i)\bgit(?:\s+-+[^-\s]\S*(?:\s+[^-\s]\S*)?)*\s+commit(?![-\w])")
