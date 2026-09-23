---
id: TASK-1064
title: 'Prod Dockerfiles run Node 25 while dev, CI and the quality gate run Node 24'
status: To Do
assignee: []
created_date: '2026-09-23 23:58'
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
