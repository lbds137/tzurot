---
id: TASK-1264
title: 'Research: move Tzurot to a Railway-managed Postgres with pgvector'
status: To Do
assignee: []
created_date: '2026-10-22 17:50'
labels:
  - 'area:db'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1252000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila 2026-10-22, during the Railway breach rotation: Tzurot's Postgres is the hard case only because it runs the custom pgvector/pgvector:pg17 image (no Database tab, no Regenerate button, password rotation needs a hand-timed ALTER ROLE; TASK-1260). If Railway now offers a managed Postgres that ships pgvector, a migration would make credential rotation and backups the supported path.

What (research only): (1) does Railway offer a managed or templated Postgres with pgvector, which major version, and does it have the Database tab and Regenerate; (2) compatibility with our use: the IVFFlat indexes and protected indexes in prisma/drift-ignore.json, extension version, PG 17; (3) migration cost: dump/restore size and downtime for both envs, the dev↔prod sync (DEV_DATABASE_URL / PROD_DATABASE_URL), backups; (4) a recommendation. Do not migrate without the owner.

Acceptance: a short research note with a recommendation; the owner decides.
<!-- SECTION:DESCRIPTION:END -->
