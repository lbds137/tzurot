---
id: TASK-1267
title: Rotation tooling follow-ups from PR 2643 final review
status: To Do
assignee: []
created_date: '2026-10-23 02:31'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1255000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: claude-review on PR 2643 (head a087711b0) posted no blocking findings; these non-blocking items were deferred so the Railway-breach prod pass was not held.

What:
1. BYOK stage 1 redeploys api-gateway before ai-worker without waiting (rotation.ts redeployByokServices), so for seconds a new gateway can encrypt with the NEW key while the old ai-worker only holds the OLD one. Redeploy the reader (ai-worker) first, check whether ai-worker ever writes encrypted rows, and narrow the ENCRYPTION_KEY_ROTATION.md claim that every intermediate state decrypts every row to stored variable states.
2. ENCRYPTION_KEY_ROTATION.md ~58-60 overclaims what a CURRENT-phase stage-1 re-run prints; make the CURRENT-DIFFERS error name the copy direction (api-gateway to ai-worker) and the deploy:redeploy commands.
3. The CURRENT-phase repair copies the key in the Railway dashboard, which may trigger a rebuild deploy; probe once on dev or note it in the text.
4. deploy:redeploy checks readiness twice (redeploy-service.ts + railway-api.ts), and the inner refusal says before rotating; drop one check or neutralise the text.
5. deploy:redeploy --dry-run could report the readiness read, and the confirm prompt fires before the refusal (owner UX call).
6. redeployCommands round-trips a joined string; pass string[] and share with reportRedeployFailures in rotate-env-context.ts.
7. Record that PR 2643 deleted the rebuild redeploy (serviceInstanceRedeploy) against TASK-1266 scope; no tooling path rebuild-redeploys in an explicit env now.

Acceptance: each item fixed or dispositioned in one PR; dev exercise for any ordering change.
<!-- SECTION:DESCRIPTION:END -->
