---
id: TASK-711
title: >-
  Autosquash leaves the base commit message unreviewed against the diff it now
  describes
status: To Do
assignee: []
created_date: '2026-08-21 01:37'
labels:
  - 'area:repo'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 711000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three claims went false-after-true in one session (2026-08-20, PR 2167), and the third nearly shipped into permanent history. The shape is NOT an unverified claim - each was accurate when written and was invalidated by later work on the same branch.

1. forwardedOriginCache module docstring said "The other fields cannot go stale at all" - falsified by adding an access-gated field to the same struct one PR later. Reviewer caught it.
2. PR body said "No new network call" - falsified when a review round added a private-thread membership lookup. Self-caught while updating the body.
3. The BASE COMMIT MESSAGE said the same thing, and fixup commits never touch the base message, so autosquash carried it forward silently. Caught only because the message was re-read by chance before force-push.

Item 3 is the one with no existing net. claim-shape-guard.sh scans staged code comments; the commit-msg hook enforces the session-URL rule. Neither reads a commit BODY for claims about the diff, and nothing at all fires at the autosquash moment - which is precisely when the base message stops matching the change it describes.

The moment is deterministic and cheap to name: after git rebase --autosquash and before the force-push, re-read the base commit message against the final diff. That is a one-line insertion into the git-workflow skill autosquash section, next to the existing pre-merge sequence.

A hook is the stronger option and worth costing out: extend .husky/commit-msg (or a pre-push check) to flag absolute claims in a commit body - no new, never, always, cannot, only - the same vocabulary claim-shape-guard already recognizes, advisory and non-blocking like that guard. Noise risk is real since commit bodies legitimately say things like no schema change; the guard precedent is that an advisory print is tolerable where a block would not be.

Related but distinct: the TASK-520 code-comment gap is about claims unverified AT AUTHORING against an external system. This is about claims TRUE at authoring that a later commit on the same branch invalidates, in a surface no guard reads.

Acceptance: the post-autosquash re-read is named in the git-workflow skill; a decision recorded either way on the commit-body hook, with the noise argument stated if declined.
<!-- SECTION:DESCRIPTION:END -->
