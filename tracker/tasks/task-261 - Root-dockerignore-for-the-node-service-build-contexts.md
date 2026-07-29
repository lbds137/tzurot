---
id: TASK-261
title: Root .dockerignore for the node-service build contexts
status: Done
assignee: []
created_date: '2026-07-13 00:00'
updated_date: '2026-07-29 01:06'
labels:
  - 'area:ci'
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 261000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Root `.dockerignore` for the node-service build contexts — The three node images build from the repo root and `COPY . .` in the pruner stage — the full tree incl. `.git/`, `reports/`, `coverage/` ships as build context on every Railway deploy AND every `docker-build-smoke` firing (#1640 review). **Fix shape**: root `.dockerignore` excluding `.git`, `reports/`, `coverage/`, `node_modules/` — verify against each Dockerfile's COPY needs (prisma/, tsconfig.json, packages/embeddings/models/ must stay) and prove with the smoke job (a `.dockerignore` addition should fire all three node legs via a lockfile-less trigger... it won't match the filters — pair it with a Dockerfile comment touch). **Promote when**: next Dockerfile/CI-build touch, or smoke-job build times get annoying. Surfaced 2026-07-13 (#1640 review).

**Why:** Build-context waste on every deploy; cheap one-file fix with a verification path.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verified shipped 2026-07-28: root .dockerignore landed in b4e06b35e (2026-07-16, website pre-release sweep) covering the full fix shape — .git, reports, coverage, node_modules — plus dist/.turbo/.astro/tsbuildinfo/junit/tzurot-legacy/docs-local/.env*. Closing as already-done.
<!-- SECTION:NOTES:END -->
