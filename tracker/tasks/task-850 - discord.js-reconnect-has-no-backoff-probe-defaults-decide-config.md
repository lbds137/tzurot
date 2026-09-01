---
id: TASK-850
title: 'discord.js reconnect has no backoff - probe defaults, decide config'
status: To Do
assignee: []
created_date: '2026-09-01 03:19'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 850000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the 2026-09-01 prod gateway outage showed the reconnect path retrying ~2/sec unbroken for 17 minutes with no backoff and no give-up. That is a Discord-side throttle/flag risk (no 429 was seen, which is luck rather than design) and it buried every other log line - 84 percent of the incident window volume was shard reconnect noise.

Premise (verified in the TASK-291 grounding pass 2026-09-01): the client is constructed at services/bot-client/src/index.ts:145-158 with only intents, partials and allowedMentions - all ws and rest retry options are at discord.js defaults. What those defaults actually DO on a gateway 503 is an external-system claim that has NOT been probed.

Fix shape: (1) probe the installed discord.js version for its gateway reconnect strategy on repeated handshake failures (source read of @discordjs/ws retry/backoff logic beats docs); (2) if there is genuinely no backoff, evaluate configuring one via the ws options surface on Client construction; (3) if defaults are sane, record that and close. The GatewayWatchdog (TASK-291) bounds the damage either way by exiting after 5 min not-Ready, so this is log-hygiene plus throttle-risk reduction, not the primary defense.

Acceptance: the actual default behaviour is recorded with a source cite, and either a backoff config ships or the decision not to is recorded with the reason.
<!-- SECTION:DESCRIPTION:END -->
