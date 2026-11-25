---
id: TASK-1534
title: >-
  Per-checkout test isolation: own Redis DB index and integration database per
  clone
status: Done
assignee: []
created_date: '2026-11-24T18:46:00Z'
updated_date: '2026-11-25T01:24:00Z'
labels:
  - area:tests
  - size:M
  - state:ready
dependencies: []
priority: high
ordinal: 1531000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a second Tzurot lane (a parallel clone, tzurot-b) is gated on this (Deck relay of Lila, 2026-11-24, minimal gate = per-lane test isolation plus a written task split). Two checkouts running the component or integration tiers at once collide on shared state: vitest.integration.config.ts:11 and vitest.component.config.ts (REDIS_URL default, line ~12) both fall back to the shared redis://127.0.0.1:6379 DB 0, and integration tests use one shared tzurot_integration_test database on tzurot-postgres (vitest.integration.config.ts:19-21).

What: derive per-checkout test state from the checkout itself (e.g. a stable suffix from the folder name), with no per-run manual setup: (1) a distinct Redis DB index per checkout for both tiers; (2) a distinct integration database per checkout, created and migrated on first use (or by a one-time ops command the tier invokes); (3) sweep for any other shared mutable test state and isolate or document each: fixed ports, fixed tmp paths, BullMQ queue names and key prefixes used by tests. CI stays as-is (it sets REDIS_URL/DATABASE_URL explicitly).

Acceptance: two checkouts run pnpm test:component (and the integration tier where it runs locally) concurrently with no cross-talk, shown by a concurrent run; the sweep list of shared state is recorded in the PR body with a disposition per item.
<!-- SECTION:DESCRIPTION:END -->
