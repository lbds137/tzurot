---
id: TASK-881
title: >-
  board-gate: a space-bearing pathspec word-splits, so a board-only commit fails
  open
status: To Do
assignee: []
created_date: '2026-09-03 21:56'
labels:
  - 'area:hooks'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 879000
---



## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised by the round-7 review on PR 2319 as low and pre-existing, RUNTIME-CONFIRMED before filing, and it is neither low nor hypothetical. On a feature branch with a board-only file, git add tracker/ followed by git commit blocks correctly at exit 2, while git add with the quoted pathspec tracker/tasks/task-1 - probe.md followed by the same commit exits 0. A board-only commit on a feature branch passes the gate — the exact class the hook exists to stop, and the one its header names as the observed threat model with three incidents behind it.

Mechanism: the ADD_RE loop does add_args.extend(segment_after(m.end()).split()). Python split with no argument splits on any whitespace run, so a quoted pathspec containing spaces tokenises into pieces. For the fixture above that is tracker/tasks/task-1, then a bare dash, then probe.md. The bare dash is skipped as a flag, the first piece matches the board allowlist, and probe.md does not — so NON_BOARD becomes non-empty and the gate concludes the commit is mixed and exits 0.

This is the gate's most common REAL input, not an exotic one: every tracker task filename carries spaces by construction (the CLI generates them that way), so the shape git add with a quoted tracker path is what an agent writes whenever it stages one task file rather than the whole directory. The session that filed this used that exact shape repeatedly.

PRE-EXISTING, not from 2319: the prior implementation piped grep -oE output through sed and split on whitespace the same way. 2319 unified detection and did not touch pathspec parsing. It is filed rather than fixed there because quote-aware parsing is a different job from the unification, and because 2319 was already seven review rounds deep.

Why no probe caught it: every existing add-shaped case stages the directory (git add tracker/), never an individual quoted filename. The fixtures do use space-bearing filenames — task-1 - probe.md — but only ever inside a directory add, so the splitting never runs on them. This is precisely the corpus-fixture failure the testing skill names: a probe input that avoids the one property every real input has.

Fix shape: the hook already imports lib/shell_quotes.py, which is where quote handling lives — the pathspec scan needs to respect quoted spans rather than raw-splitting. Check whether an existing helper there can return tokens with quoted spans intact; if not, that is the natural home for one. Do NOT simply split on quotes inline in the ADD_RE loop; the sibling hooks share this lib deliberately.

Acceptance: a quoted space-bearing tracker pathspec plus a commit blocks (exit 2); the directory form and all 65 existing cases stay green; the new case has a demonstrated failing mutation. Add cases for both the double-quoted and single-quoted spellings.
<!-- SECTION:DESCRIPTION:END -->
