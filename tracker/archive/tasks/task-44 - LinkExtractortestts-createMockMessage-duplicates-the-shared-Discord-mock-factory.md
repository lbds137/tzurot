---
id: TASK-44
title: >-
  LinkExtractor.test.ts createMockMessage duplicates the shared Discord mock
  factory
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
updated_date: '2026-09-04 19:43'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'area:testing'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`LinkExtractor.test.ts` `createMockMessage` duplicates the shared Discord mock factory

**Why:** The local `createMockMessage` in `LinkExtractor.test.ts` reinvents guild/channel/`permissionsFor`/`members.fetch`/`isDMBased`/`isThread`/`isTextBased` stubs that `../../test/mocks/Discord.mock.ts` already provides. It exists because the shared factory's `client` field only stubs `{ user: { id } }` — no `client.guilds`/`client.channels` sub-stubs, which `fetchMessageFromLink` needs. **Fix shape**: enrich the shared factory's `client` with `guilds.cache`/`guilds.fetch`/`channels.fetch` stubs, then switch `LinkExtractor.test.ts` to the shared import. **Why not now**: enriching a shared mock used by every sibling test in `handlers/references/` has test-wide blast radius — its own change, not a cleanup-PR rider. **Promote when**: next touching the shared Discord mock, or a third `handlers/references/` test needs the client sub-stubs. Surfaced 2026-06-29 (PR #1393 claude-review, non-blocking).
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:43
---
Pass 2026-09-04 (TASK-888 half 1), owner ruling: ARCHIVED. admission bar (06-backlog.md: there is deliberately no state for the-only-trigger-is-next-time-someone-touches-this; a task in it should never have been filed). The trigger event and the need are the same diff: the third handlers/references test needing the shared mock is written by someone looking at the existing two.
---
<!-- COMMENTS:END -->
