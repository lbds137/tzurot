---
id: TASK-1447
title: >-
  Consolidate the strict-decimal parsers (api-gateway parseFiniteNumber,
  bot-client STRICT_DECIMAL_RE)
status: To Do
assignee: []
created_date: '2026-11-17T23:52:00Z'
labels:
  - area:common-types
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1447000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/bot-client/src/commands/preset/config.ts:137 (STRICT_DECIMAL_RE, trim plus regex, no exponent) and services/api-gateway/src/services/diagnosticCost.ts (DECIMAL_NUMBER_PATTERN in parseFiniteNumber, exponent allowed) are two copies of the same strict-decimal parse that avoids parseFloat trailing-text leniency (claude-review on PR 2762, final round).

What: one helper in common-types/utils with an exponent option, colocated test, both callers switched.

Acceptance: one regex source; both call sites keep their current accepted sets (exponent rejected in bot-client, accepted in api-gateway), pinned by tests.
<!-- SECTION:DESCRIPTION:END -->
