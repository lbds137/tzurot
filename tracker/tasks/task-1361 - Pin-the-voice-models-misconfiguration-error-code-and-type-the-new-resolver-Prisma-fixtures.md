---
id: TASK-1361
title: >-
  Pin the voice-models misconfiguration error code and type the new resolver
  Prisma fixtures
status: To Do
assignee: []
created_date: '2026-11-08T08:38:00Z'
labels:
  - area:api-gateway
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1344000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review round 4 on PR 2721 (TASK-1022), merged at the review step-back point with these open. (1) services/api-gateway/src/routes/user/voiceModels.test.ts, test 'should return 500 instead of the undecryptable-key 401 when encryption is not configured', pins the response body only negatively (message is not the re-enter copy); add a positive assertion on what the client actually receives (the error code asyncHandler emits, expected INTERNAL_ERROR, read it from the handler rather than assuming). (2) The new cases in voiceModels.test.ts and services/api-gateway/src/utils/elevenLabsKeyResolver.test.ts use (mockPrisma.user.findFirst as any).mockResolvedValue({...}); per 02-code-standards Core Principle 8, type them (vi.mocked plus satisfies) so a schema change breaks them at compile time.

Acceptance: the positive assertion reds when the guard is changed to return a 401; the typed fixtures compile and the suite stays green.
<!-- SECTION:DESCRIPTION:END -->
