---
id: TASK-1083
title: >-
  Redis clients hard-code IPv6, so the integration tier cannot reach Redis on an
  IPv4-only host
status: Done
assignee: []
created_date: '2026-09-24 17:42'
updated_date: '2026-09-24 18:43'
labels:
  - 'area:redis'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1076000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-09-24 cloud capability probe (doc-108 § Billing and limits) ran the integration tier in a cloud VM whose kernel has no IPv6 (redis-cli -h ::1 fails with Address family not supported). 46 of 50 files passed, but describeImageWithFallback.integration.test.ts failed with ioredis MaxRetriesPerRequestError, because every Redis client forces family 6 for the Railway private network: packages/common-types/src/utils/redis.ts (the family ?? 6 default and a second hard-coded site), services/api-gateway/src/queue.ts, services/ai-worker/src/index.ts, services/bot-client/src/services/ResultsListener.ts (grep family: 6 over services/*/src and packages/*/src, non-test). A runtime module-shim remap of family 6 did not take. The cloud lane is now the only place the integration tier can run outside CI (the Deck OOMs on it), so this is the one probed cloud limit a code change removes.
Fix shape: one env override read in one place (e.g. REDIS_IP_FAMILY, values 4, 6 or 0, default 6 so Railway is unchanged), threaded through every client site listed above (re-grep family: 6 first); set it to 0 in vitest.integration.config.ts only when unset, or document it for the cloud setup script. Keep the Railway default pinned by a test.
Acceptance: pnpm test:integration passes in a cloud VM with no IPv6, with REDIS_IP_FAMILY set by the setup script; prod and dev still connect over IPv6 (default unchanged, test-pinned).
<!-- SECTION:DESCRIPTION:END -->
