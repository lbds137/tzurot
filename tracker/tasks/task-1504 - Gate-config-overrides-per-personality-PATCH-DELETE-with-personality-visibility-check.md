---
id: TASK-1504
title: >-
  Gate config-overrides per-personality PATCH/DELETE with personality visibility
  check
status: To Do
assignee: []
created_date: '2026-11-22T04:53:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1504000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR 2782 claude-review r1 (medium). GET /api/user/voice-resolution now gates private characters via canUserViewPersonality (404), but PATCH and DELETE /api/user/config-overrides/:personalityId (services/api-gateway/src/routes/user/config-overrides.ts:274,327) still upsert/update userPersonalityConfig for any UUID without checking existence or visibility, so a write can land before read-back 404s. What: add canUserViewPersonality visibility gate returning 404 Personality on handleUpdatePersonalityOverrides and handleClearPersonalityOverrides; add unit tests pinning private non-owner 404 and owner/public access. Acceptance: non-owners cannot write or delete config overrides for private characters; tests pin both handlers.
<!-- SECTION:DESCRIPTION:END -->
