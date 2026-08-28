---
id: TASK-789
title: >-
  Paid-path vision invocation sends prefixed z-ai model id to the z.ai API — 400
  code 1214
status: To Do
assignee: []
created_date: '2026-08-28 02:55'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 789000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: first live test of flash as the PAID global vision default (owner, 2026-08-28 02:44Z dev, requestId d9813774-0da9-420a-8364-a3b0995b3370): the image-job vision invocation sent modelName="z-ai/glm-5.3-flash" and z.ai returned 400 code 1214 "modelCode: does not exist" (apiKeySource="system", isGuestMode=false). The walk degraded to a lower tier and the description succeeded, so the failure is invisible to the user — every fresh image just burns a failed call first. The SAME config (GLM 5.3 Flash Reasoning: high, model z-ai/glm-5.3-flash) works on the TEXT path (runtime-verified during the beta.209 piggyback swap), and the GUEST vision path invokes flash successfully with the bare id (2026-08-27 21:45Z logs) — so the code-read hypothesis is the prefixed OpenRouter-form id reaching the z.ai endpoint unstripped on the non-guest vision path; runtime-confirm the provider/client seam at fix time per /tzurot-bug-remediation before building.

Rider: the 400 was classified errorCategory="bad_request" errorType="transient" shouldRetry=true — z.ai 1214 is a permanent config error; retrying costs ~7s before fallback. Check the z.ai error-code classification alongside the fix.

Fix shape: normalize the z-ai/ prefix at the vision invocation seam for z.ai-direct providers, mirroring whatever the working text path does (grep how the ZaiCoding/text client normalizes); regression test pinning that a prefixed stamped id crosses the z.ai client boundary bare; class-sweep any other path that passes stamped model ids to z.ai unmodified.

Acceptance: with the paid global vision default pointed at the flash config, a fresh image is described BY flash (success log with the bare model id, no 1214); both prefixed and bare config forms work; the 1214 class no longer retries.
<!-- SECTION:DESCRIPTION:END -->
