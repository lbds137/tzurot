---
id: TASK-540
title: >-
  Catalog-unavailable save rejection returns 400, not a transient-retryable
  status
status: To Do
assignee: []
created_date: '2026-08-12 02:49'
labels:
  - 'area:api-gateway'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 540000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: llmConfigValidation routes both the absent and the unavailable branch of validateModelAndContextWindow through ErrorResponses.validationError, so a save blocked by an unreachable model catalog returns HTTP 400. PR 2070 made the MESSAGE tell an outage apart from a typo, but the STATUS still says "your input was wrong" for a transient server-side condition a client could reasonably auto-retry.

What: decide whether the unavailable branch should carry 503 (or 502) instead, and thread a distinguishable result out of validateModelAndContextWindow so the route can pick. Note the ripple: bot-client surfaces gateway errors to the user, so changing the status changes what a user sees during an outage and may interact with any retry wrapper — that is the design question, not the status constant itself.

Why not in 2070: the message fix stands alone and is strictly an improvement; changing an HTTP contract plus its client handling is a separate unit with a user-visible dimension.

Acceptance: either the unavailable branch returns a transient status with bot-client handling verified, or the decision to keep 400 is recorded with its reason.
<!-- SECTION:DESCRIPTION:END -->
