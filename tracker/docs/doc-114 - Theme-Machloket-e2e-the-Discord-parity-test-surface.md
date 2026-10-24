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

Pick the surfaces the interop already exercises — message send/receive, gateway events, slash commands — and stand up the harness against the Machloket server's dev A/B.

## Ordering and coordination

Scope after the current TASK-1252..1256 drain batch (interleaving is the Tzurot session's call). Joins the fleet tooling push: the Machloket Client session is building Playwright + screenshot verification in the same window.
