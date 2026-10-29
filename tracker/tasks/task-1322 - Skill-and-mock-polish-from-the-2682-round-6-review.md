---
id: TASK-1322
title: Skill-and-mock polish from the 2682 round-6 review
status: To Do
assignee: []
created_date: '2026-10-29T01:51:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1305000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Four non-blocking items from the PR 2682 round-6 review, filed at merge at the review-round cap. (1) Add vi.hoisted to the tzurot-testing mock-factory constraint as the preferred fix (no await import in the factory, so the cycle cannot form and no copy drifts); inline-and-pin becomes the fallback for mocks shared across test files. (2) The safe-case example (aliasBatch.mock.ts value-importing buildRemoveCustomId from aliasBrowseView.ts) holds only at time of writing - say so in the text or drop the file name and rely on the mock comment warning. (3) The pin comment in aliasBatch.test.ts says Guards the mock defaults (plural) but pins one constant - reword to the mock's inlined prefix. (4) Optionally move the mock fixture drift describe below the file-local helpers to keep the setup-helpers-suites order. Acceptance: each item lands or gets a recorded reason.
<!-- SECTION:DESCRIPTION:END -->
