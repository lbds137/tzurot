---
id: TASK-1067
title: docker-compose.yml and README drift from the real local containers
status: Done
assignee: []
created_date: '2026-09-23 23:58'
updated_date: '2026-09-24 19:15'
labels:
  - 'area:repo'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1061000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: docker-compose.yml names volumes redis-data/postgres-data while the real containers use tzurot-redis-data/tzurot-postgres-data, still carries the obsolete top-level version: key, and no compose tool is installed on the Deck; README.md (~line 224) says "Podman (SteamOS/Distrobox)" but podman runs on the host. Both containers now have restart=always with podman-restart.service enabled (sibling env-cleanup session, 2026-09-23).
Fix shape: either make docker-compose.yml match the real setup (volume names, drop version:) and say how to run it with podman, or delete it and document the podman run commands; fix the README line.
Acceptance: the documented local-infra setup reproduces the running containers.
In flight 2026-09-24 as #2511 (owner rulings: delete docker-compose.yml, and recreate the live containers on 127.0.0.1-only ports, done that day). At merge: mark Done, then message the Deck-management session so that dev-docs RESTORE.md points at README § Local Development.
<!-- SECTION:DESCRIPTION:END -->
