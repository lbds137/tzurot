---
id: TASK-1111
title: >-
  Retire the tzurot-orchestration sections the harness delegation skill now
  carries
status: To Do
assignee: []
created_date: '2026-09-25 21:59'
labels:
  - 'area:repo'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: harness 0.3.5/0.3.6 ported the portable parts of /tzurot-orchestration into the harness `delegation` skill (spec template with project slots, step-0 self-heal, checked transfer, stale worktree and branch cleanup, review-round cap, cloud appendix incl. the core.md § Safety paste and the fixup-then-driver-autosquash round contract, the worktree.baseRef head sentence). Two copies of the same procedure drift; the Tzurot copy is 4 KB of the skills byte budget that #2541 just ratcheted up. Agreed with the Deck management session on 2026-09-25: retire duplicates after #2541, Tzurot driver decides which.

Fix shape: compare the two skills section by section; keep in tzurot-orchestration only what is Tzurot-specific (worktree:transfer and its finalize-rewrite path, the depcruise/cpd gate naming, the Railway/Deck constraints, the cloud step-0 block with this repo commands, the mode table) and replace each ported section with a one-line pointer to the harness `delegation` skill section. Cloud units do not load harness skills either: keep the cloud appendix material that a cloud spec must carry inline. Fix the awkward "Routines (RemoteTrigger) work and bill the plan like cloud sessions now do" sentence while there (claude-review nit on #2541). Then `pnpm ops lines:update-baseline --surface skills` down.

Acceptance: no procedure text appears in both skills; every pointer names a heading that exists in the harness skill (grep it); lines:check green with the skills baseline ratcheted down; a nested dispatch and a cloud launch each run from the trimmed skill without a missing step.
<!-- SECTION:DESCRIPTION:END -->
