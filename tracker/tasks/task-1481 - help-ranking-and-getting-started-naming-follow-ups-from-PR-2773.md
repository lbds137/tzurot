---
id: TASK-1481
title: /help ranking and getting-started naming follow-ups from PR 2773
status: To Do
assignee: []
created_date: '2026-11-20T06:37:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1481000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2773 made /help autocomplete match descriptions too; results sort alphabetically and cap at 25, so a broad query can push an exact path match out behind description-only matches. The same PR renamed the getting-started embed field to Customize while docs/guides/getting-started.md added a section named Make it yours.
What: sort path matches before description matches (then alphabetical), with a test of more than 25 description hits plus one late path hit; pick one name for the embed field and the guide section.
Acceptance: the path hit survives the cap in the test; one name in both places.
<!-- SECTION:DESCRIPTION:END -->
