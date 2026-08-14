---
id: TASK-88
title: >-
  Distinguish transient vs deterministic failures in MistralTtsProvider negative
  cache
status: Done
assignee: []
created_date: '2026-05-04 00:00'
updated_date: '2026-08-14 00:05'
labels:
  - 'area:voice'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 88000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Distinguish transient vs deterministic failures in `MistralTtsProvider` negative cache

**Why:** The 5-min negative cache catches all non-rate-limit failures uniformly. Deterministic failures (401 auth, malformed reference) get cached identically to transient failures (5xx, network blips). PR #974 added one explicit skip for `MistralReferenceAudioTooLongError`. **Fix shape**: route catch through `error.isTransient`; only set negative cache when `isTransient === true`. ~15-20 LOC + tests. **Promote when**: opportunistic alongside next `MistralTtsProvider` edit OR if cache-poisoning produces user-visible delay. Surfaced 2026-05-04 PR #974. Deferred 2026-05-07.
<!-- SECTION:DESCRIPTION:END -->
