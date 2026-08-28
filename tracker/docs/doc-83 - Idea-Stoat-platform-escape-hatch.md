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

## Shape if pursued (not a plan, a sketch)

1. tzurot's architecture already isolates the platform: `bot-client` is the only Discord-coupled service. A Stoat adapter is a sibling bot-client against `stoat.js`; gateway/ai-worker/voice-engine untouched. Masquerade replaces the webhook dance outright.
2. Missing platform features (slash commands, voice messages) are **upstream contributions or a thin patch set**, not a hard fork — Stoat is actively developed and a permanent fork means owning a Rust backend, a Solid web client, mobile apps, and LiveKit ops while tracking upstream drift forever.
3. Self-hosting cost + the network-effect problem (users have to move) are the real gates, not the code.

## Promote when

The owner decides to invest in a platform exit — first step would be a scoping spike: stand up a self-hosted Stoat instance, probe the bot API hands-on, and read the upstream roadmap/issue tracker for slash-command intent.
