---
id: TASK-857
title: >-
  cwd-drift-guard misses the cd-inside-the-same-command shape, which is the one
  that strands canary mutations
status: To Do
assignee: []
created_date: '2026-09-01 19:18'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 857000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: hit 3 times in one session (2026-09-01, PR 2288). The guard already exists and works: .claude/hooks/cwd-drift-guard.sh blocked a repo-relative git pathspec the moment the persistent shell had been LEFT in packages/identity by a prior call. That is the stale-drift case and it is covered.

The gap: the guard inspects the shell cwd as it is when the command STARTS. A compound command that changes directory itself is therefore invisible to it. Shape that got through, three times:

  cd packages/identity && npx vitest run <file> && git checkout -- packages/identity/src/personality/PersonalityService.ts

The shell was at the repo root when this started, so the guard passed it. The git step then ran from packages/identity, the repo-relative pathspec resolved to packages/identity/packages/identity/... and failed with "did not match any file(s) known to git" — after the tests in the chain had already run and scrolled the interesting output away.

Why this specific shape is worth guarding rather than just remembering: every one of the three occurrences was a CANARY REVERT (Core Principle 9 — mutate the source, confirm the test reddens, revert). When the revert silently fails, the mutation stays applied to a production source file. In a tests-only PR that is a source change that nobody asked for, and it is caught only if the next command happens to run git status. Twice it was; the cost of the miss is not theoretical.

Fix shape: extend cwd-drift-guard.sh to also parse the COMMAND TEXT, not only the ambient cwd — if the command contains a cd into a subdirectory anywhere before a git subcommand that takes a repo-relative pathspec, block it with the same message it already prints (use git -C or run the git step in its own call). The existing message is good and needs no change. Watch for false positives: a command that cds and then uses git -C, or an absolute path, must still pass.

Also worth considering as a cheaper partial: flag any command where a canary-shaped revert (git checkout -- or git restore) appears after a cd, regardless of path form, since that is the high-cost subset.

Acceptance: the three-times-observed shape above is blocked; git -C and absolute-path variants after a cd still pass; the hook probe covers both directions (see guard:hook-probes — every hook needs a probe).
<!-- SECTION:DESCRIPTION:END -->
