---
id: TASK-411
title: Re-wire or consciously drop the denylist mutation rate limiter
status: To Do
assignee: []
created_date: '2026-08-03 18:27'
labels:
  - 'size:S'
dependencies: []
priority: medium
ordinal: 411000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: createRedisDenylistRateLimiter is applied only inside createDenylistRoutes (routes/admin/denylist.ts), a legacy factory imported only by its own test. Production mounts (_generated/mounts.ts) serve /api/admin/denylist* and /api/internal/denylist/cache with NO rate limiter - denylist mutation rate limiting is silently absent in prod. Surfaced by the 2026-08-03 drift audit. Security-dimension call: owner decides fix-vs-drop (routes are admin-auth gated, so the limiter is defense-in-depth against a compromised admin token, not a public-surface gap).
Fix shape: either attach the limiter in the generated-mount registration path, or decide the admin-auth surface does not need it and delete the limiter + dead factory together.
Acceptance: limiter provably active on denylist mutations (test asserting the 429 path) OR limiter and factory removed with rationale in the commit.
<!-- SECTION:DESCRIPTION:END -->
