---
id: TASK-1525
title: >-
  release:draft-notes routes every type! commit into Breaking Changes; surface
  the user-facing-only rule at draft time
status: To Do
assignee: []
created_date: '2026-11-24T03:14:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1520000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: notes-format.ts drafts every conventional-commit `!` title under Breaking Changes (grep `BREAKING` / `!` routing in packages/tooling/src/release/notes-format.ts). That is how the beta.249 internal schema rename reached the section and DMed every user. TASK-1521 added a publish-time guard (assertNoUnapprovedBroadcast in publish.ts) and defined the section as user-facing only, but the drafter still routes `!` commits there, so the decision surfaces only at release:publish, the last step.

What: move the decision to draft time. Either the drafter emits an HTML comment under the section restating the user-facing-only definition and the --broadcast-all consequence, or release:verify-notes warns when the section is non-empty.

Acceptance: drafting notes from a range with a `feat!:` commit shows the user-facing-only warning before publish; a test pins it.

Source: claude-review on PR #2800, finding 1 (medium).
<!-- SECTION:DESCRIPTION:END -->
