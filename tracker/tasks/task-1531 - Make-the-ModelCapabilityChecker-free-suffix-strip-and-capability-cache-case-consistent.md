---
id: TASK-1531
title: >-
  Make the ModelCapabilityChecker free-suffix strip and capability cache
  case-consistent
status: To Do
assignee: []
created_date: '2026-11-24T14:30:00Z'
labels:
  - area:ai-worker
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1528000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: resolveFromRedis compares catalog ids case-insensitively, but normalizeModelId strips the :free suffix with a case-sensitive regex, so foo/bar:FREE keeps its suffix and the normalizedId branch misses; capabilityCache stays keyed by the caller-cased id while the presence memo is lowercase. Raised by claude-review on PR 2801 round 5.

What: add the i flag to the :free strip in normalizeModelId (services/ai-worker/src/services/ModelCapabilityChecker.ts, grep normalizeModelId) and key capabilityCache by the lowercased id.

Acceptance: tests pin a :FREE id resolving and two casings sharing one capability-cache entry.
<!-- SECTION:DESCRIPTION:END -->
