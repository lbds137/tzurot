---
id: TASK-1577
title: >-
  ImageDescriptionJob: honor per-key demotion marks (vision job bypasses
  keyState)
status: To Do
assignee: []
created_date: '2026-11-27T22:23:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:ready
dependencies: []
priority: low
ordinal: 1567000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2829 review round 3 finding 3 - ImageDescriptionJob resolveGuestMode derives the tier from provenance only, so a BYOK user with a live invalidkey:/nocredits: mark keeps running image descriptions on the dead user key for the mark TTL (failed attempts on their own key; the main-turn path is covered via effectiveTier, which the AuthStep demotion steers). What: read resolveKeyState (or effectiveTier with keyState) in ImageDescriptionJob resolveGuestMode, mirroring the AuthStep gate INCLUDING its OpenRouter effectiveProvider scope; demote to the free cascade. Acceptance: a marked BYOK user gets the free cascade for image descriptions in a unit test, and the OpenRouter-scope gate has its own test. Promote when: next touch of ImageDescriptionJob or the next demotion-scope change.
<!-- SECTION:DESCRIPTION:END -->
