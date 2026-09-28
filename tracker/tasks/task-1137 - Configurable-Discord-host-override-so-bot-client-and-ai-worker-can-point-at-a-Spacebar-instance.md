---
id: TASK-1137
title: >-
  Configurable Discord host override so bot-client and ai-worker can point at a
  Spacebar instance
status: To Do
assignee: []
created_date: '2026-09-27 21:05'
updated_date: '2026-09-28 04:08'
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

Owner requirement (relayed verbatim by the Machloket client session, 2026-09-27 ~17:10): "Tzurot should be able to connect to both Discord and Machloket at the same time." So this override is PER PROCESS and ADDITIVE, never a global repoint: a bot-client process with the config set talks to the instance, one without it talks to Discord (the default and primary), and the shared services (ai-worker CDN guards) accept Discord's hosts AND the configured origin at once. Running two bot-client processes is this task's route to both-at-once; the shared-data questions that raises are TASK-1138.

What: one config (env var, in .env.example, validated at startup with fail-fast) naming the instance origin; when set: Client rest api base + deployCommands REST use it, and the CDN guards additionally allow exactly that one origin (scheme + host + port exact match, never a wildcard or a bare host add; the SSRF intent survives because it is a single configured origin). Message-link parsing: decide in the PR whether to accept the instance host (report the call). Unset config = byte-for-byte Discord behavior (pin with tests).

Security dimension: this widens the SSRF allowlist; exact-origin match + https-only keeps it an operator-configured single origin. Any wider shape is an owner call.

Acceptance: with the config unset every existing guard test passes unchanged; with it set, the configured origin (incl. its non-default port) passes both CDN guards and a same-host different-port or http URL is refused; bot-client REST and deployCommands target the configured base (seam test on the REST options). Then a joint boot against the instance with the Spacebar fork session.

Joint boot is DECK-LOCAL (Spacebar fork session, 2026-09-27): the instance is tailnet-only (Tailscale Serve, no Funnel; public exposure would be an owner call), and Railway is not on the tailnet, so Railway dev cannot reach REST, gateway or CDN. Run bot-client (+ api-gateway, ai-worker) locally with the origin env set to https://deck.tail00338f.ts.net:8443; the Deck resolves that name to 127.0.0.1 (owner hosts line) and Caddy :8443 proxies to the instance (a discord.js 14.27 bot reached ClientReady there, 17:06). Data isolation: the local .env points at the local containers (tzurot-postgres localhost:5432 db `tzurot`, tzurot-redis localhost:6379, checked 2026-09-27), not Railway, so the boot touches no Railway data; to keep the owner's local dev data clean too, use a separate database (e.g. `tzurot_spacebar` on the same container, migrated with `pnpm ops db:migrate` against that URL) and a separate Redis db index (REDIS_URL `/1`), plus the instance's own bot token and application id.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code merged 2026-09-28 04:06Z as PR #2554 (62962798e): per-process DISCORD_INSTANCE_ORIGIN; CDN guards path-scoped to DISCORD_INSTANCE_CDN_PATH_PREFIXES (never /api) after a round-3 SSRF finding. Stays OPEN for the Deck-local joint boot with the Spacebar fork session (separate DB tzurot_spacebar + Redis /1). Open item: Spacebar CDN signature IP/UA binding may 403 ai-worker fetches. Boot waits for the owner's go (weekly-limit pause).

Spacebar fork session (2026-09-28): the instance serves the CDN at the origin root on the same port as /api (matches discordRestOptions); security.cdnSignUrls=false (also the code default), so the IP/UA-binding 403 concern is inert. If signing is ever enabled, set cdnSignatureIncludeIp and cdnSignatureIncludeUserAgent false first (bot-client and ai-worker fetch with different UAs). Joint boot still waits for the owner's go.
<!-- SECTION:NOTES:END -->
