---
id: TASK-6
title: Railway env-var audit follow-ups (sweep done 2026-07-17)
status: To Do
assignee: []
created_date: '2026-07-16 00:00'
updated_date: '2026-09-04 19:37'
labels:
  - 'area:voice'
  - 'area:tooling'
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-16 (owner request) — Railway env-var audit: **sweep DONE 2026-07-17** (every var on all 5 services × both envs traced to a live read; findings + method in `docs/local/SECRETS_AUDIT_2026-07-17.md`). ONE dead var found and REMOVED (owner, dashboard, 2026-07-17): `DEFAULT_VOICES` on voice-engine (both envs). **Residual**: encode expected per-service var sets in `setup-railway-variables.ts` so drift is checkable via `deploy:setup-vars --dry-run`. **Promote when**: next deploy-tooling touch, or the next stray-var incident.

**Why:** The sweep is point-in-time; the manifest is what makes it stay true.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:37
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. The residual ask — "encode expected per-service var sets in setup-railway-variables.ts so drift is checkable via --dry-run" — is not yet satisfied: the file already declares per-service `VariableConfig` arrays and a `dryRun` flag, but `--dry-run` only previews what a local `.env` WOULD push to Railway; it never reads live Railway vars back to flag an extra/stray var (the exact DEFAULT_VOICES class this task exists to prevent a repeat of). Evidence: `sed -n '280,420p' packages/tooling/src/deployment/setup-railway-variables.ts` → `setVariable`/`applyVariables`/`printSummary` are push-only, no read-back diff.
---
<!-- COMMENTS:END -->
