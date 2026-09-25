---
id: doc-83
title: 'Idea: Stoat platform escape hatch'
type: other
created_date: '2026-08-28 01:54'
---

_Owner musing 2026-08-27: long-term unhappiness with Discord as a platform; wants an exit path without reinventing the wheel. Parked — no work scheduled; unrelated to any release._

## The idea

Instead of cloning Discord or building a client against a reverse-engineered Discord API, adopt **Stoat** (formerly Revolt, rebranded Oct 2025 after a C&D) as the target platform: self-host an instance and close the feature gap between Stoat and what tzurot actually uses on Discord — rather than forking the whole platform blind.

## What's verified so far (web-searched 2026-08-27; re-probe before acting — this moves)

- **Masquerade is native**: per-message name/avatar/colour override in the messages API, purpose-built for exactly what tzurot hacks via Discord webhooks. Persona display would get *simpler*, not harder. (stoatchat GitHub issues + stoat.py webhook/masquerade docs.)
- **Official `stoat.js` JS library** exists; ecosystem also has Stoatx (decorator framework) and Revoice.js (voice channels).
- **Voice infra migrated to LiveKit**; Vortex is retired legacy. Self-host guides cover the LiveKit setup.
- **No slash-command/interactions framework found** — bots appear to be prefix-command era. This is the biggest parity gap for tzurot's UX (the whole `/settings`, `/deny`, dashboard surface).
- **Voice messages (record-and-send clips)**: no native support found — the owner uses these heavily on Discord.
- **Licensing not pinned down** — check per-repo (core is believed AGPL-class; the awesome-list's MIT covers only the list) before any fork planning.
- Unverified: mobile client maturity (historically the weak point).

## The Spacebar alternative (owner raised 2026-08-27)

**Spacebar** (ex-Fosscord) is the other honest candidate and takes the opposite bet: instead of a new platform with its own API, it reimplements **Discord's own API** as a self-hostable server (TypeScript; api + gateway + cdn + voice in one repo). If its interactions/application-command surface actually works, tzurot's existing discord.js `bot-client` could point at a Spacebar instance nearly unchanged — no adapter rewrite, slash commands and components for free. That inverts the cost profile vs Stoat: zero bot-side rewrite, but you inherit whatever Discord-API corners Spacebar hasn't finished, and no masquerade-style primitive beyond Discord's own webhooks (which tzurot already uses, so parity, not regression).

- Verified: active GitHub org, self-hostable, "discord compatible chat, voice and video platform" per its own README; known gaps acknowledged in community reviews (threads buggy, no forums/stage).
- **Unverified and load-bearing**: whether interactions (slash commands, buttons, modals, autocomplete) are implemented server-side — that's THE spike question. Third-party review-site claims ("production-ready", "voice overhauled") are low-trust AI-slop-shaped; only a hands-on probe counts.
- Decision axis if this ever promotes: Spacebar = keep our client code, gamble on their API completeness. Stoat = rewrite the platform seam once, get a cleaner native platform (masquerade) but contribute slash commands/voice messages upstream ourselves.
- **Fork viability (owner asked 2026-08-27): Spacebar is the better fork target if its API support falls short.** Server is TypeScript under AGPL-3.0 (verified on the repo — our stack's language; Stoat's backend is Rust), and gap-filling there is spec-implementation against Discord's documented API with tzurot's own bot-client as the free conformance test — vs designing a new API surface for Stoat. Scope is bounded to tzurot-conformance (grep bot-client for its discord.js surface = the checklist), not Discord-completeness. Posture would be a patch-set fork (track upstream, rebase, PR back what generalizes), never hard divergence. Caveat: the server is half the platform — client maturity (incl. voice-message record/playback UX) is spike question #2.

## Shape if pursued (not a plan, a sketch)

1. tzurot's architecture already isolates the platform: `bot-client` is the only Discord-coupled service. A Stoat adapter is a sibling bot-client against `stoat.js`; gateway/ai-worker/voice-engine untouched. Masquerade replaces the webhook dance outright.
2. Missing platform features (slash commands, voice messages) are **upstream contributions or a thin patch set**, not a hard fork — Stoat is actively developed and a permanent fork means owning a Rust backend, a Solid web client, mobile apps, and LiveKit ops while tracking upstream drift forever.
3. Self-hosting cost + the network-effect problem (users have to move) are the real gates, not the code.

## Promote when

The owner decides to invest in a platform exit — first step would be a scoping spike: stand up a self-hosted Stoat instance, probe the bot API hands-on, and read the upstream roadmap/issue tracker for slash-command intent.

## 2026-09-25 owner input (relayed from Discord #general via the Deck management session)

Still parked; nothing scheduled. Recorded because the requirements moved.

Her words:

- "I honestly want to fork and self host something so Tzurot has a proper home"
- "thinking about having Claude look into Spacebar"
- "I just want a Discord clone without their shitty leadership"
- "if I do this I'd definitely explore cross platform federation"

What changed:

- **Federation is a new requirement.** Cross-platform federation was not in this doc before. It weighs against a plain Discord-API reimplementation (Spacebar has no federation story; Stoat has none either) and is the one axis where the Matrix-shaped option in `doc-79` scores, so the two docs now pull in different directions and any spike has to score federation explicitly.
- **Stoat data point.** A server member who tried Stoat reported it is "very similar for the end-user, but server setup/management/bot support is a bit under developed from a staffing perspective"; the owner replied "that's my beef with Stoat". That tilts the comparison above toward Spacebar for the bot surface. The same member was scathing about Matrix, which `doc-79`'s brief currently favours for sovereignty; a counterpoint to weigh, not a verdict.
- **Cross-link**: `doc-79` (Theme: Platform decoupling) is the sovereignty framing this idea would serve; its brief lives in `docs/local/PLATFORM_DECOUPLING_BRIEF.md`.

Ripeness (driver's read, owner's call): the stated intent ("have Claude look into Spacebar") is a bounded read-only spike, not a build. If she un-parks it, the first unit is the Spacebar interactions-completeness spike from the section above (slash commands, components, modals, autocomplete, webhooks, voice messages), scored against the discord.js surface `bot-client` actually uses, plus one paragraph on what federation would mean for each candidate. Offered on the owner queue in `backlog/now.md`.

## Status 2026-09-25: UN-PARKED for the spike

Owner ruling 2026-09-25: "I'd like to do the spike soon." The spike is `TASK-1108` (part 1 the read-only map against Spacebar's server source plus the federation paragraphs; part 2 the hands-on instance probe). No new repo for the spike; a fork is a decision the spike informs. This doc receives the dated summary and the recommendation when part 1 lands.

## 2026-09-25 spike part 1 result (TASK-1108; long form in the gitignored `docs/local/spacebar-spike.md`; Spacebar server read at commit d211b0d, 2026-09-24; code-read only, nothing run)

- **Spacebar has the persona path already**: webhook execute with username, avatar_url, thread_id and file uploads (`api/util/handlers/Webhook.ts`); messages, history, replies, forwards, embeds, Components V2, DMs, reactions and typing are implemented.
- **Interactions are half built**: the server delivers commands, buttons and selects to the bot, and registration works, but the reply half Tzurot depends on is a stub or missing: deferred reply is a TODO (`interactions/.../callback.ts`, `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE`), editReply/followUp resolve to an unknown webhook, modal and autocomplete responses are absent from the schema, update ignores the message text, gateway resume always answers Invalid Session. Tzurot defers every command then edits the reply (~570 `editReply` sites), so every slash command would fail at its first reply today. The callback route checks no auth and never compares the interaction token.
- **discord.js can be pointed at another host** through public options (`rest.api`, `rest.cdn`, `rest.mediaProxy`); the gateway follows via `GET /gateway/bot`. bot-client changes needed: the Client passes no `rest` option (`index.ts`), `utils/deployCommands.ts` builds a bare `new REST()`, and Discord CDN hosts are hard-coded in `discordCdnGuard.ts` and ai-worker's `attachmentFetch.ts`.
- **Federation**: neither Spacebar nor Stoat has any (Stoat's FAQ: not on the roadmap). Federation favours only the Matrix-shaped option in `doc-79`, which needs its identity work first; it does not choose between Spacebar and Stoat.
- **Recommendation (owner to rule)**: fork Spacebar as a patch-set, provisionally; part 2 decides. The gap is ~six handlers plus the auth hole, all specified by Discord's docs; Stoat has no interactions framework at all.
- **Part 2 probe (local, podman)**: read `spacebarchat/missing-routes`; run Spacebar with its own Postgres (never `tzurot-postgres`: the snowflake id spaces overlap); drive it with a standalone discord.js 14.27 script (`rest.api` = `http://localhost:3001/api`) before touching bot-client, rows in order: identify + forced reconnect, global command PUT, webhook execute with thread_id + file + wait, `POST /interactions` → deferReply → editReply (expect Unknown Webhook), ephemeral reply, deferUpdate + update, modal + autocomplete, voice-flagged upload, and whether the Fermo client sends interactions and voice messages.

## Owner ruling 2026-09-25: FORK SPACEBAR

"I'm good with forking Spacebar. We can contribute upstream later if they aren't super shitty about AI contributions; otherwise we keep the fork to ourselves." Consequences: TASK-1108 part 2 (the podman probe against upstream) is GO and runs before any patch is written; the fork repo is created when the first patch exists, not before. Repo shape is open: a GitHub fork is public by construction, so "keep it to ourselves" means a private repo with upstream's history pushed in, tracking upstream by rebase. AGPL-3.0 note (not legal advice): section 13 requires offering the modified source to users who interact with the server over a network, so a private fork still has to be source-available to the people on the instance; that is a link, not a public repo.
