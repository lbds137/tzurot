---
id: doc-114
title: 'Theme: Machloket e2e - the Discord parity test surface'
type: other
created_date: '2026-10-24 16:07'
---

# Theme: Machloket e2e — the Discord parity test surface

Seeded by Lila on 2026-10-24 (via Deck), after the morning's Tzurot↔Machloket interop milestone. Her framing: Discord-local was always the blocker for end-to-end tests, and Machloket brings that into the suite — "the whole point of Machloket is to maintain as close parity as possible with Discord, so it's a valuable resource on that front." E2E against Machloket IS the Discord-parity test surface.

## Standing rulings on mismatches (Lila, 10-24)

A Machloket↔Discord gap is SIGNAL, not an obstacle. Discord is the authoritative source; Machloket (the Spacebar fork) is by design supposed to match the Discord API, ideally the UI too. An e2e mismatch is a finding: file it, and route it — a Machloket API gap goes to the machloket sessions; a genuine Discord-behavior nuance informs the Tzurot side.

## First unit

Pick the surfaces the interop already exercises — message send/receive, gateway events, slash commands — and run them against a throwaway server booted by the Machloket server's own e2e harness, not the shared dev A/B instances. It runs locally for now; CI follows once the harness can be reached from CI. Implementation goes through `lane-meters --for implement`. Security regression tests for the server live in the server's repo, not in this one.

### What the spike showed (2026-11-02)

discord.js with bot-client's real client options ran against `bootInstance()` (a run takes about 25 s, boot about 20 s of that). These passed: READY, GUILD_CREATE, send, edit, reply, delete, typing, webhook identity and files, guild, global and context-menu commands, defer then edit, ephemeral follow-up, buttons, selects, reactions, member chunk, permissions, snowflake time, presence, error codes 10003, 10008, 10013 and 10007, and DMs both ways.

Gaps, sent to the Machloket Server session the same day. The Discord side of 3 and 4 is from memory of its docs, not probed:

1. The default config closes the gateway to a client with no User-Agent, which discord.js is, and `login()` never returns. Instance B is immune only through its config.
2. The harness's `cdn.endpointPublic` trailing slash makes attachment URLs `//attachments/...`: 404 as given, 200 with one slash.
3. Bulk PUT and POST of application commands echo the request, with no `id` or `version`.
4. Webhook `username` is held to 2 to 32 characters, against Discord's 1 to 80. A persona name plus suffix over 32 gets a 400.
5. A 2001-character message is accepted, against TR-3.3's 2000.
6. A modal submit with a text input fails the request schema, so by code-reading every Tzurot modal fails on submit from the Machloket client.

Machloket Server's answer the same day, confirmed by its reading of the code and not yet run or deployed: 1 to 4 and 6 are in its worker; 5 is Lila's call on the server side. It messages when a fix lands; each workaround stays until then. Its fix for 4 is 1 to 80, which leaves a further gap: the instance's `blockedContains` list refuses names holding spacebar, steam, community, support or ticket, where Discord's docs name only clyde and discord, so a persona with "support" in its name still gets a 400 (also Lila's call there). A 2000 limit can be pinned whichever default she picks, through `limits.message.maxCharacters` on `bootInstance`.

### Later units

- Tzurot's own handlers and `deployCommands` read `getConfig()`, whose origin check accepts https only (`discordInstanceOrigin.ts`), and the harness is http. Driving them needs TLS in the harness or a loopback exemption; that choice is made when the unit is picked.
- CI, once the harness can be reached from it.

## Ordering and coordination

Promoted out of cold on 2026-11-01 (owner posture: automate as much testing as possible). Starts after TASK-1331 and TASK-1332..1335. Joins the fleet tooling push: the Machloket Client session is building Playwright + screenshot verification in the same window.

**What it can and cannot replace.** It covers behaviour against a Discord-shaped API, so it can stand in for dev runs that only prove Discord-facing behaviour. It does not replace the end-to-end dev exercise that `00-critical.md` § Testing requires for tooling that writes to a live environment: a throwaway server has no Railway variables, deployments or database to observe.
