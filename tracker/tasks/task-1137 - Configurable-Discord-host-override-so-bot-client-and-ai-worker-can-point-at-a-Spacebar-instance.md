---
id: TASK-1137
title: >-
  Configurable Discord host override so bot-client and ai-worker can point at a
  Spacebar instance
status: To Do
assignee: []
created_date: '2026-09-27 21:05'
labels:
  - 'area:bot-client'
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1129000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ruling 2026-09-25 (doc-83): fork Spacebar and run Tzurot against the owner's instance. The Spacebar fork session (its own repo and driver) needs a Tzurot-side host override before bot-client can connect; Discord must stay the default when the config is unset.

Surface (verified at develop 99724da21 by the driver):
- services/bot-client/src/index.ts: new Client({...}) has no rest option (no REST api base override).
- services/bot-client/src/utils/deployCommands.ts:231: bare new REST().setToken(token).
- services/bot-client/src/utils/discordCdnGuard.ts:11: DISCORD_CDN_HOSTS hard-coded.
- services/ai-worker/src/utils/attachmentFetch.ts:23: ALLOWED_HOSTS hard-coded, and its guard rejects any non-standard port (docblock at :130).
- services/ai-worker/src/utils/discordCdnExpiry.ts:57 reuses ALLOWED_HOSTS.
- packages/common-types/src/utils/messageLinkParser.ts: message-link hosts are discord.com variants (a Spacebar instance's message links would not parse).

Instance facts (from the Spacebar fork session): REST base https://deck.tail00338f.ts.net:8443/api, API version 10; gateway is discovered by discord.js via /gateway/bot (wss://deck.tail00338f.ts.net:8443); media origin https://deck.tail00338f.ts.net:8443.

What: one config (env var, in .env.example, validated at startup with fail-fast) naming the instance origin; when set: Client rest api base + deployCommands REST use it, and the CDN guards additionally allow exactly that one origin (scheme + host + port exact match, never a wildcard or a bare host add; the SSRF intent survives because it is a single configured origin). Message-link parsing: decide in the PR whether to accept the instance host (report the call). Unset config = byte-for-byte Discord behavior (pin with tests).

Security dimension: this widens the SSRF allowlist; exact-origin match + https-only keeps it an operator-configured single origin. Any wider shape is an owner call.

Acceptance: with the config unset every existing guard test passes unchanged; with it set, the configured origin (incl. its non-default port) passes both CDN guards and a same-host different-port or http URL is refused; bot-client REST and deployCommands target the configured base (seam test on the REST options). Then a joint boot of dev bot-client against the instance with the Spacebar fork session.
<!-- SECTION:DESCRIPTION:END -->
