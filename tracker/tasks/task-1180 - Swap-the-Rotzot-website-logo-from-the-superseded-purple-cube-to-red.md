---
id: TASK-1180
title: Swap the Rotzot website logo from the superseded purple cube to red
status: To Do
assignee: []
created_date: '2026-10-05 14:13'
labels:
  - 'area:website'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 1171000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/website/src/assets/rotzot-logo.webp (the dev-brand site logo, unchanged since fc0aeef0f on 2026-07-16) is the purple cube. The owner told the Characters session on 2026-10-05 that Rotzot purple is superseded by red. The full-size originals now live in tzurot-characters images/_tzurot-logos/ (rotzot-logo-red-a.jpeg, rotzot-logo-red-b.jpeg; per the owner each bot logo has two takes, Discord profile picture and website). Per the 2026-10-05 ruling the originals are NOT copied into this repo; only the derived web asset changes.

Owner question: which red take (a or b) is the website one, and should rotzot-banner.webp change too?
Recommendation: the take the owner names as the website version; derive a 1024x1024 transparent cut-out matching the current tzurot-logo.webp treatment, and check the banner in the same PR.

Acceptance: the dev site (Rotzot brand) shows the red logo; the substitution guard from fc0aeef0f stays green.
<!-- SECTION:DESCRIPTION:END -->
