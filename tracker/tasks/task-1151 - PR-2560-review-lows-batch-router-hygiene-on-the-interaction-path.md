---
id: TASK-1151
title: 'PR 2560 review lows batch: router hygiene on the interaction path'
status: To Do
assignee: []
created_date: '2026-10-01 04:07'
labels:
  - 'area:bot-client'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1143000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2560 (app-id hygiene filter, merged) drew three review rounds; all findings were low/non-blocking and merged per the standing authorization, with the recurring lows batched here instead of a fourth review round. Source: claude-review bodies 2026-10-01 00:04Z and prior.

What (all in services/bot-client interactionRouter/foreignInteraction/interactionFamilies + tests):
1. Narrow InteractionFamily.label from string to a literal union (or derive from the table) so the router switch gets compile-time exhaustiveness; add a never-check in the default arm.
2. Widen routeInteraction try to cover the pre-guard warm + guard calls, or attach .catch at the void routeInteraction call site (async boundary shift: sync throws there are now unhandled rejections; global log-and-live handler catches them today).
3. Cover the two new explicit arms: own-app interaction matching a classifier-only family (default: no-op) and matching no family (undefined early return).
4. Defensive guard for getCommandFromCustomId when customId is undefined on a carriesCustomId-family synthetic (mirror the client.application fail-open posture).
5. Hedge or pin the dispatchChatInput comment claiming the activity stamp is a harmless idempotent NOW-write (claim-shape standard; relocated content).

Acceptance: all five addressed in one bot-client PR; suite + quality green; the interactionRouter zero-ack set stays byte-intact.

INPUT FROM PR #2561 ROUND 1 (claude-review 2026-10-01 08:14Z, all nits, merged-as-is per the reviewer's own offered path): (6) api-gateway queue.ts startup log omits db - the exact log line that would have caught the all-46-on-db-0 incident; add it for consistency with createIORedisClient. (7) ResultsListener.test.ts:248 comment describes the pre-fix arrow mock shape; the factory is now a constructible function - reword. (8) redis.test.ts /0 case's `?? 'collapsed-to-undefined'` only decorates the failure message, never changes pass/fail - simplify to a plain toBe(0).
<!-- SECTION:DESCRIPTION:END -->
