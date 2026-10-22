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

Railway's own guides (published 2026-10-22 01:26Z, read the same night, paraphrased by the fetch tool):
- Postgres (blog.railway.com/p/security-disclosure-recommendation-rotate-postgresql-database-credentials): the supported path is the database service's Database tab, Config, Connection section, Regenerate next to the password. Railway changes the password inside Postgres, updates POSTGRES_PASSWORD and the variables built from it, and restarts the database, which drops every open session (so session A in the plan above does not survive it). Dependent services fail to reconnect until redeployed. The guide warns NOT to edit POSTGRES_PASSWORD/PGPASSWORD by hand or run ALTER USER yourself, because either one alone leaves the variable and the database out of sync. Our manual plan does both sides on purpose, so it is the fallback if the Regenerate button is missing for the pgvector image. Checked by Lila 2026-10-21: pgvector has no Database tab at all, so no Regenerate; the manual plan above is THE path for pgvector. It does have a Console tab (a shell in the container), which is the break-glass: if the TCP password breaks, a local-socket psql from the console can still ALTER ROLE, provided pg_hba trusts local connections (to be confirmed in the dev console before prod). On 2026-10-21 ~21:50 EDT the Console tab failed with "websocket connection failed" (same outage as the hung railway ssh), so the break-glass is unavailable during the incident. Hard preconditions before the PROD rotation: (a) the dev console connects and the passwordless local-socket probe `env -u PGPASSWORD -u PGHOST psql -h /var/run/postgresql -U "${POSTGRES_USER:-postgres}" -d postgres -c 'select current_user'` prints a user, plus `grep -v '^#' "$PGDATA/pg_hba.conf" | grep .` shows a local trust rule; (b) a manual backup from pgvector's Backups tab (it restores pg_authid, i.e. the old password, as a last resort).
- Redis (…-rotate-redis-database-credentials): the same Regenerate button; do not edit the password variable or run CONFIG SET requirepass by hand. So the Redis line above is replaced by Regenerate, then redeploy every consumer.
- Both guides: check whether Public Access (TCP proxy) is on and turn it off if nothing outside the project needs it. Ours: the pgvector public URL is how the local ops tooling reaches the databases, so it stays on unless we change that.
- Misuse checks to add to step 8: deploy logs for `password authentication failed` (Postgres) and `WRONGPASS`/`NOAUTH` (Redis); after rotation, pg_stat_activity and Redis CLIENT LIST for sessions we do not recognise; `SELECT rolname FROM pg_roles` for unknown roles; unexpected extensions; DBSIZE and INFO keyspace against expectations; the Railway audit log for who viewed or changed variables.

Acceptance: dev rotated and verified end to end, the procedure corrected from what that run showed, prod rotated, and the now.md entry updated.

Promote when: Railway builds and deploys resume.
<!-- SECTION:DESCRIPTION:END -->
