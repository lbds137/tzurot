---
id: TASK-1064
title: 'Prod Dockerfiles run Node 25 while dev, CI and the quality gate run Node 24'
status: Done
assignee: []
created_date: '2026-09-23 23:58'
updated_date: '2026-09-24 03:42'
labels:
  - 'area:deploy'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1058000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: services/{api-gateway,ai-worker,bot-client}/Dockerfile and services/website/Dockerfile:18 use FROM node:25-slim (every stage), while dev (mise node 24 since 2026-09-23) and CI run 24, and root package.json engines.node is ">=24.0.0", which admits 25. No .node-version / .nvmrc pins it. So prod runs a Node major our gates never exercise (dependency-cruiser even rejects 25 locally, per the global dev notes). Found by a sibling env-cleanup session 2026-09-23; Dockerfile lines verified with git grep "FROM node" the same day.
Fix shape: align on one major. Recommendation: 24 (the LTS line the gates run; 25 is a short-lived odd release). Change every FROM node:25-slim to node:24-slim, tighten engines.node to ">=24 <25", add a .node-version (24) so mise/CI/Docker read one pin; release-note it and watch the first deploy.
Acceptance: git grep "FROM node:25" returns nothing; engines.node excludes 25; a single pin file names the major.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-23 23:55
---
DONE 2026-09-23: PR #2496 (6bed5c8b6). Every surface is on Node 24 behind `.node-version`:
- the 10 Dockerfile FROM lines;
- engines ">=24.0.0 <25.0.0";
- `@types/node` ^24.13.6 in 17 manifests (services/website added in review round 1: its astro/sharp peers had resolved 26);
- CI's 6 setup-node steps via node-version-file;
- a Dependabot ignore on `@types/node` majors.

packages/tooling/src/node-version-pin.test.ts fails CI on drift in any of the 4 scanned surfaces. Acceptance: FROM node:25 is gone outside tracker history; engines excludes 25; one pin file names the major (CI reads it, the guard enforces the rest).

Found on the way: Node 25 reached end of life on 2026-06-01 (nodejs/Release schedule.json), so prod had run an unsupported major for about four months.

Deploy note for beta.229: prod moves 25 -> 24, so watch the first deploy's startup logs.

Not covered: jsdoc-type-pratt-parser (via eslint-plugin-regexp) keeps its own @types/node 26.6.1. The guard reads direct declarations only, and a readlink sample of 4 workspaces showed each resolving 24.13.6.
---
<!-- COMMENTS:END -->
