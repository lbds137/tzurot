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

## Ordering and coordination

Promoted out of cold on 2026-11-01 (owner posture: automate as much testing as possible). Starts after TASK-1331 and TASK-1332..1335. Joins the fleet tooling push: the Machloket Client session is building Playwright + screenshot verification in the same window.

**What it can and cannot replace.** It covers behaviour against a Discord-shaped API, so it can stand in for dev runs that only prove Discord-facing behaviour. It does not replace the end-to-end dev exercise that `00-critical.md` § Testing requires for tooling that writes to a live environment: a throwaway server has no Railway variables, deployments or database to observe.
