---
id: TASK-6
title: 'Railway env-var audit: sweep DONE 2026-07-17 (every var on all 5 services × both envs…'
status: To Do
assignee: []
created_date: '2026-07-16 00:00'
labels:
  - 'area:voice'
  - 'area:tooling'
  - 'area:docs'
dependencies: []
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-16 (owner request) — Railway env-var audit: **sweep DONE 2026-07-17** (every var on all 5 services × both envs traced to a live read; findings + method in `docs/local/SECRETS_AUDIT_2026-07-17.md`). ONE dead var found and REMOVED (owner, dashboard, 2026-07-17): `DEFAULT_VOICES` on voice-engine (both envs). **Residual**: encode expected per-service var sets in `setup-railway-variables.ts` so drift is checkable via `deploy:setup-vars --dry-run`. **Promote when**: next deploy-tooling touch, or the next stray-var incident.

**Why:** The sweep is point-in-time; the manifest is what makes it stay true.
<!-- SECTION:DESCRIPTION:END -->
