---
id: TASK-1313
title: >-
  rotate-env stage 2: a FAILED verifier redeploy says re-running is safe, but
  the re-run's readiness preflight refuses it
status: To Do
assignee: []
created_date: '2026-10-27T21:24:00Z'
labels:
  - area:tooling
  - size:S
  - state:ready
dependencies: []
priority: medium
ordinal: 1296000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found in PR 2676 review. packages/tooling/src/secrets/verifier-redeploy-wait.ts terminal-failure refusal (TERMINAL_BAD_STATUSES branch) ends with the default rerunNote, "Re-running stage 2 is safe because redeploying the verifier is idempotent". When the new verifier deployment ends FAILED/CRASHED/REMOVED/SKIPPED it becomes latestDeployment, so the re-run is refused by assertRailwayServiceDeploymentReady (railway-api.ts:501) and by redeployRailwayServiceReusingImageWithSource (railway-api.ts:562); the operator needs a hand deploy:redeploy first.

What: give the DEFAULT wording the same terminal-branch recovery text PR 2676 gives BYOK (name the hand redeploy, wait for SUCCESS, then re-run stage 2), and update the pinned rotate-env text and its tests deliberately.

Second member (same shared-message class, PR 2676 round 2): the trigger-failure message in the same wait helper (formatRedeployTriggerError) says the service "may already be restarting" even when nothing restarted. redeployRailwayServiceReusingImageWithSource (railway-api.ts) refuses BEFORE the mutation when the latest deployment is not SUCCESS ("Cannot redeploy ... resolve that before rotating"), and the wait wraps that refusal in the restarting text. It is reachable in BYOK stage 2 because ai-worker's trigger runs after the whole api-gateway wait, which can last minutes. Fix: tell a pre-mutation refusal apart from a mutation failure (a typed error or a distinct message prefix) and word each accurately, for the default wording and BYOK alike. The helper is renamed service-redeploy-wait.ts by PR 2676; if that has not merged yet, the file is verifier-redeploy-wait.ts.

Third member (PR 2676 final review): the superseding-deployment refusal (evaluateNewDeploymentStatus, the branch for a third deployment id appearing during the wait) gives BYOK no repair command. BYOK's shortRerunNote replaces the full rerunNote in that parenthesized slot, so the text reads "check it reached SUCCESS in Railway, then re-run BYOK stage 2 (no row has been re-encrypted)". If that third deployment ends FAILED/CRASHED/REMOVED/SKIPPED it becomes the latest deployment and the re-run's preflight refuses, which is the case terminalRecovery covers for the new deployment but not here. shortRerunNote takes no context, so it cannot name the service. Fix: let shortRerunNote take the same context as rerunNote, or add the hand deploy:redeploy command to the superseding sentence when the wording supplies terminalRecovery; add a BYOK-wording test for this path (none pins it today). Not observed live.

Acceptance: the rotate-env FAILED/CRASHED refusal names the hand redeploy step; a refused trigger does not claim a restart may be under way; a superseding deployment that ends terminal names the hand redeploy in the BYOK text; tests pin all three.
<!-- SECTION:DESCRIPTION:END -->
