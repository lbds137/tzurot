---
id: TASK-466
title: >-
  Retire lib/git-command.sh and reduce the agreement test to the two live Python
  copies
status: Done
assignee: []
created_date: '2026-08-08 00:36'
updated_date: '2026-08-09 00:27'
labels:
  - 'area:tooling'
  - 'area:process'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 466000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner directive 2026-08-07: do the most correct thing. This is the follow-up that #2002 deliberately did NOT ride, because it is a test-structure change rather than a hook-channel one and belongs in its own reviewed unit (ship in bounded units).

Why retire it: .claude/hooks/lib/git-command.sh has had ZERO runtime consumers since #2002 re-homed claim-shape-guard and fixup-rider-check, which stopped doing command-text matching entirely. Its only remaining role is as the bash column in gitCommitPatternAgreement.test.ts.

The merits argument, which is what decides it: the agreement test exists to stop the two BLOCKING Python guards (develop-code-commit-guard, git-commit-filter-guard) from drifting apart. A third copy in a language nothing executes cannot cause a runtime bug when it drifts, but it does impose a change-one-change-three obligation. That is cost without payoff. I first declined to delete it because it is a test fixture - that is a reason it is inconvenient to remove, not a reason it earns its keep.

What the refactor must preserve (checked before filing, do not lose these):
- DIVERGENCE_CASES keeps its value. Row 1 (non-ASCII suffix) becomes both-Python-reject; row 2 (U+00A0 separator) becomes both-Python-accept. Row 2 is the load-bearing one - it is what makes adding re.ASCII to either Python copy FAIL the test, because the flag would narrow \s and miss a real commit. That assertion survives without the bash column.
- The distinctness assertion (expect(new Set(patterns).size).toBe(patterns.length)) still matters with two sources: it catches an extractor edited to capture the same substring twice, which would make every case compare a pattern against itself and pass unconditionally.

Work: delete lib/git-command.sh; drop SOURCES[0] and the bashVerdict machinery from gitCommitPatternAgreement.test.ts; trim the leading element from each DIVERGENCE_CASES expectedByLabel array; update the test header (it says "three times, in two languages"); update the "Kept in agreement with the other two copies" comments in develop-code-commit-guard.sh and git-commit-filter-guard.sh; check the GNU-grep-on-PATH caveat in the test header, which exists only for the bash column and can go with it.

Acceptance: file deleted, agreement test green with two Python sources, both divergence rows still pinning Python behaviour, and a canary check that editing one Python regex alone still fails the test.

Note 2026-08-08: fixup-rider-check.sh has since been deleted outright (TASK-472 — the rider class is delegated to review), so one of the two former consumers named above no longer exists. The merits argument is unchanged and slightly stronger: the file has fewer former consumers, not more.
<!-- SECTION:DESCRIPTION:END -->
