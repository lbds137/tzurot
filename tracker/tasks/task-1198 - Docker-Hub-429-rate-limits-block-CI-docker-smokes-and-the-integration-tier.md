---
id: TASK-1198
title: Docker Hub 429 rate limits block CI docker smokes and the integration tier
status: To Do
assignee: []
created_date: '2026-10-09 22:05'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1188000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
2026-10-09: three consecutive CI runs on PR #2594 failed with Docker Hub 429 pulling node:24-slim and integration service containers from registry-1.docker.io on shared GitHub runner IPs (verified in job logs: unexpected status 429 from HEAD request). Smokes die at Build image in under 30s; integration dies at Initialize containers. Reruns are an IP lottery - the same SHA passed on the fourth attempt ~2h later. Durable fix: add a docker/login-action step (or DOCKER_CONFIG with an auths entry) to the docker-build-smoke and integration jobs using DOCKERHUB_USERNAME + DOCKERHUB_TOKEN secrets. The secrets need the owner to create them in repo settings; the ci.yml change rides a normal develop PR (only claude-code-review.yml and claude.yml need main-cut). Until then, 429-shaped failures (fast Build image fails + Initialize containers) are rerun-eligible infra.
<!-- SECTION:DESCRIPTION:END -->
