---
id: TASK-1524
title: >-
  Share the release-notes section parser between the announce classifier and the
  publish guard
status: To Do
assignee: []
created_date: '2026-11-24T02:10:00Z'
updated_date: '2026-11-24T02:10:00Z'
labels:
  - area:tooling
  - size:S
  - state:dependent
dependencies:
  - TASK-1521
priority: medium
ordinal: 1522000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: assertNoUnapprovedBroadcast in packages/tooling/src/release/publish.ts copies H3_HEADING_RE, TRAILER_RE and the section-walk logic from parseReleaseSections in services/api-gateway/src/services/releaseNotes.ts. If the classifier changes how it finds a non-empty Breaking Changes section and the guard does not, a release can DM every user again without --broadcast-all (the beta.249 incident, TASK-1521).

What: move the section parser (regexes plus the walk) into common-types next to RELEASE_LEVEL_SECTIONS (packages/common-types/src/constants/releaseNotes.ts) and have both modules import it; or, if a shared runtime helper is not wanted in common-types, add a parity test that feeds one fixture set through both functions.

Acceptance: one source for the H3 and trailer regexes and the non-empty-section rule, or a test that fails when the two disagree on any fixture.
<!-- SECTION:DESCRIPTION:END -->
