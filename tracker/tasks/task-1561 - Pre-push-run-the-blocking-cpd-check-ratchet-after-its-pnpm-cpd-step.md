---
id: TASK-1561
title: 'Pre-push: run the blocking cpd:check ratchet after its pnpm cpd step'
status: To Do
assignee: []
created_date: '2026-11-26T16:20:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1555000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2819 passed local pnpm quality at 1649 filtered CPD lines, was then rebased onto develop (which had gained ai-worker routing commits), and CI failed the ratchet at 1666 > ceiling 1656: one wasted CI cycle and a review round. .husky/pre-push step 8 already runs pnpm cpd (fresh report) but is warning-only and never runs pnpm ops cpd:check, so a post-rebase push skips the ratchet entirely.

What: after the existing pnpm cpd call in .husky/pre-push, run pnpm ops cpd:check as a BLOCKING step (it only reads the fresh report, sub-second). Before changing it, search for a prior decision to keep CPD warning-only (the step comment says warning only); if one exists, record why it is reversed. Update the hook probe if the registry covers pre-push.

Acceptance: a push whose fresh jscpd count exceeds the ceiling fails pre-push with the cpd:check message; guard:hook-probes green.
<!-- SECTION:DESCRIPTION:END -->
