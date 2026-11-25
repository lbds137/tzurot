---
id: TASK-1538
title: Generate the Backlog Map from tracker data on every tracker change
status: To Do
assignee: []
created_date: '2026-11-25T07:46:00Z'
labels:
  - area:tooling
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1538000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the Tzurot Backlog Map on the Deck hub (outbox entry tzurot-backlog-map) is a hand-written HTML snapshot. The 11-19 08:08 version sat unchanged through 18 tracker commits until Deck flagged it on 11-25; a hand-refreshed page drifts whenever nobody remembers to redo it. doc-68 names the Backlog Map regenerated from data as a later Seyag-extraction step; this pulls that piece forward in Tzurot.

What: (1) an ops command (packages/tooling, per the No Standalone Scripts rule), e.g. pnpm ops backlog:map, that renders the page fragment from tracker data: open-task counts by state, priority, size and area; the owner queue with each Owner question and Recommendation line; the ready drain queue; the active epic and the now.md sections; releases since the previous render from git tags. Narrative theme prose either comes from a structured field on the theme docs or is dropped, so nothing on the page is hand-maintained. Keep the current page design (docs/local/dispatch/backlog-map-1119.html is the visual reference). (2) A trigger so the page re-renders after each tracker change lands on develop, without a session remembering: a post-merge or post-commit hook scoped to tracker/ and backlog/ paths, or a Deck timer that runs the command when origin/develop tracker/ moved. The push into the outbox uses deck-outbox-page, which exists only on the Deck, so the trigger must no-op cleanly elsewhere (CI, cloud units).

Acceptance: committing a tracker status change on develop updates the hub page within one trigger cycle with no manual step; the counts on the page match pnpm ops backlog:digest at the same commit, pinned by a unit test over a fixture tracker.
<!-- SECTION:DESCRIPTION:END -->
