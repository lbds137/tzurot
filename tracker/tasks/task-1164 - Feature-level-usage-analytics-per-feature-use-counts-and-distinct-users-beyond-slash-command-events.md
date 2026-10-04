---
id: TASK-1164
title: >-
  Feature-level usage analytics: per-feature use counts and distinct users
  beyond slash-command events
status: To Do
assignee: []
created_date: '2026-10-04 16:46'
labels:
  - 'area:api-gateway'
  - 'area:docs'
  - 'size:L'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1156000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner intake 2026-10-04 (own words): "need analytics / usage stats that are more detailed, to help understand which features are used, how often, and by how many users (to help prioritize building new features / improving existing ones)". CHECKED FIRST: doc-12 (Observability and Telemetry) already owns this theme. SHIPPED: P0.1 command_events (prisma model CommandEvent: one row per slash or context-menu invocation, userId, guildId, channelKind, dotted command, outcome, latencyMs, allowlisted context JSON), P1.1 pnpm ops telemetry:report (invocations plus distinct users per command, dark features, per-user breadth, error rate), P1.2 inference attribution via usage_logs (pnpm ops telemetry:inference). OPEN GAPS that this ask names: (a) command_events records slash commands only - it has no event for non-command features: plain-message character triggers (the main product use), voice in/out (STT, TTS), vision, memory retrieval, reply and mention triggers, button and select-menu actions inside dashboards; (b) characterId is reserved but not populated by any emission site (schema comment), so per-character usage is unanswerable; (c) the report is on-demand markdown with no trend or cohort view (weekly active users, retention); (d) TASK-773 (join the live command roster to list zero-invocation commands) and TASK-758 (classification fidelity) and TASK-1147 (outcome=ok is a default, not evidence of success) are open data-quality work that affects any bigger report.
What: scope a P2 slice of doc-12 (it says P2 is build-only-on-demand: this is the demand). Candidate: an allowlisted feature_events emission (or new command-path names) for the (a) list, populate characterId, then extend telemetry:report with weekly distinct-user counts per feature and a trend. Keep doc-12 hard constraints: counts and ids only, never content; privacy-policy rider in the same release; included in /export; erased with the account.
Acceptance: telemetry:report answers, for the trailing 30 days, uses and distinct users for each of: plain-message turns, voice STT, voice TTS, vision, memory retrieval, and each slash command; a privacy-policy rider ships with the first new event.
<!-- SECTION:DESCRIPTION:END -->
