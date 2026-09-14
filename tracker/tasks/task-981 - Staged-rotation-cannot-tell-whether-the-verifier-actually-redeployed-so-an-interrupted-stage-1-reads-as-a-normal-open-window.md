---
id: TASK-981
title: >-
  Staged rotation cannot tell whether the verifier actually redeployed, so an
  interrupted stage 1 reads as a normal open window
status: To Do
assignee: []
created_date: '2026-09-14 19:29'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 977000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: round-5 review finding on PR 2427, corrected in that PR by MESSAGE only. writeStage1ValuesAndRedeploy upserts _PREVIOUS, upserts the new primary, then redeploys the verifier. A kill between the last upsert and the redeploy - Ctrl-C, a network drop, or on this machine an external-display power-off, which kills in-flight commands - leaves Railway holding a new primary and a DIFFERENT _PREVIOUS, which is correctly non-degenerate, while the verifier was never redeployed and knows neither value. Re-running stage 1 then throws the same "a rotation window is already open, run stage 2 then stage 3" message it throws after a fully successful stage 1. An operator who follows it runs stage 2, the presenters move to the new primary while the verifier still runs pre-rotation code, and every request 401s - the exact window the staged design removes, entered under an instruction that reads as safe. PR 2427 makes that message tell the operator to confirm the redeploy landed first. This task is the detection the message stands in for.

PROBED 2026-09-14 (Opus, dev project token, read-only): Railway exposes variablesForServiceDeployment(projectId, environmentId, serviceId) alongside the plain variables query. Against the dev api-gateway both returned 30 keys and the same value for INTERNAL_SERVICE_SECRET. That establishes the query EXISTS and returns a comparable shape. It does NOT establish that it reflects the running deployments snapshot and therefore diverges from variables after a write the service has not picked up - no rotation was in flight, so there was no divergence to observe. The name suggests that semantics; treat it as unverified until seen diverging.

The cheapest place to verify it is the dev rotation run that closes TASK-976 and TASK-963: between stage 1s upsert and the verifiers redeploy completing, a real divergence exists for a few seconds. Capture both queries then, comparing SHA-256 digests rather than values, and record which way it went.

Fix shape, if the semantics hold: before stage 2 acts, compare the verifiers variablesForServiceDeployment value for the rotated name against the shared-tier value. Equal means the verifier is running the new primary and stage 2 is safe. Different means stage 1s redeploy never landed or has not finished, and stage 2 must REFUSE rather than warn, because proceeding is what opens the window. The same check makes stage 1s window-already-open refusal able to say which state it is in instead of hedging. Digest comparison only - no value may reach stdout, a log, an error message, or a committed file.

Acceptance: stage 2 refuses when the verifier is not yet running the new primary; the refusal names the wait rather than the operator guessing; the probe result above is replaced by a recorded observation of the two queries diverging or not; the message-only hedge added in PR 2427 is replaced by a cite of the shipped check.
<!-- SECTION:DESCRIPTION:END -->
