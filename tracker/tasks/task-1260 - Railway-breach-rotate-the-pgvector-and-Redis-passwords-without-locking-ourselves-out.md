---
id: TASK-1260
title: >-
  Railway breach: rotate the pgvector and Redis passwords without locking
  ourselves out
status: To Do
assignee: []
created_date: '2026-10-21 23:49'
labels:
  - 'area:db'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: high
ordinal: 1248000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the Railway env-var exposure (backlog/now.md, Production Issues) leaked POSTGRES_PASSWORD and REDIS_PASSWORD. Lila (2026-10-21): pgvector is not a stock Railway database, its dashboard tools are limited, so the rotation must be planned to avoid a lockout.

Facts read 2026-10-21 (railway status plus the unrendered variables API, values never printed):
- Image pgvector/pgvector:pg17 in both envs.
- On pgvector, POSTGRES_PASSWORD is the only literal; PGPASSWORD, DATABASE_URL and DATABASE_PUBLIC_URL are built from it.
- api-gateway and ai-worker DATABASE_URL are references to pgvector.DATABASE_URL, so they pick up a change on redeploy.
- Two cross-env LITERAL copies must be updated by hand: dev api-gateway PROD_DATABASE_URL and prod api-gateway DEV_DATABASE_URL.
- Redis: REDIS_PASSWORD is the only literal; every REDIS_URL is a reference to Redis.REDIS_URL.

Key premise (documented behaviour of the official postgres image that pgvector builds on; not yet verified on our service): POSTGRES_PASSWORD only applies when an empty data directory is initialised. Changing the variable does NOT change the real password. The real change is ALTER ROLE in SQL.

Plan, dev first as the rehearsal, then prod. Needs Railway deploys to work.
1. Generate an alphanumeric password (no URL-special characters).
2. Open session A over DATABASE_PUBLIC_URL and keep it open for the whole procedure (an open session survives a password change, since auth happens only at connect).
3. In A: ALTER ROLE <POSTGRES_USER> WITH PASSWORD <new>.
4. Open session B with the new password. If B fails, ALTER back from A and stop.
5. Set POSTGRES_PASSWORD on pgvector to the new value with skipDeploys (no pgvector restart needed).
6. Redeploy api-gateway and ai-worker right away. Between step 3 and this redeploy, any new pool connection still using the old password fails, so keep the gap short.
7. Update the two cross-env literal copies, then redeploy api-gateway in that env.
8. Verify: health endpoints, a bot reply, no auth errors in the logs.
Redis: set REDIS_PASSWORD, redeploy Redis, then redeploy every service that references it (unverified: whether the Redis service applies the variable at start).

Break-glass to check BEFORE prod: shell access to the pgvector container (railway ssh) for a local-socket psql. A railway ssh probe on dev hung for 90 s on 2026-10-21 (deploys paused at the time); pg_hba local rules unread.

Acceptance: dev rotated and verified end to end, the procedure corrected from what that run showed, prod rotated, and the now.md entry updated.

Promote when: Railway builds and deploys resume.
<!-- SECTION:DESCRIPTION:END -->
