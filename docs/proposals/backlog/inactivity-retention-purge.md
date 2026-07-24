# Automated Inactivity Retention & Purge

**Status:** ACCEPTED 2026-07-23 (owner + council trio). Active epic (temporarily displaces the UX Platform-Portable epic, which parks as next-up).

**Motivation:** A non-commercial, single-operator bot should not retain per-user data (conversations, memories, facts, user-created personas/characters, usage logs) indefinitely for people who stopped using it. Data-minimization posture, not a legal mandate — but GDPR Art. 5(1)(e) ("storage limitation") is the framing. Triggered by beta.174's release blast: 26 users failed with Discord `50278` (left every shared server) — genuinely unreachable, and if inactive, purge candidates.

## Accepted design

**Retention model: single 180-day inactivity window** (owner call — council flagged a flat 90-day full-wipe as too aggressive; personas/memories are user-*created* content, and 1–2 month absences are normal). One clock, simplest to build/audit for a solo operator.

### Signals (schema additions on `User`)

- **`lastActiveAt DateTime?`** — stamped on ANY interaction (chat turn, slash command, data write). **Backfilled** at migration time from the best available historical signal (`MAX` of last `UsageLog` / `conversationHistory` / persona·character·memory timestamps) rather than defaulting to ship-time — otherwise a years-abandoned account gets a fresh 180d for no benefit (council: the "zombie cohort"). Users with no historical data have nothing to purge anyway.
  - Central stamp point: gateway user-enrichment middleware (catches all data-touching commands) + a lightweight bot-client "activity touch" for pure-client commands (`/help`). Owner confirmed the central-stamp approach over derive-from-data (which would miss `/help`-only users).
- **`dmUndeliverableSince DateTime?`** — stamped when a DM permanently fails with a **per-user** unreachable code: **`50278`** (left every shared server) **and `50007`** (cannot send to this user — blocked / DMs disabled). Cleared on any successful reach/interaction.
  - **Never `20026`** (bot-level quarantine). Rationale is a blast-radius safety property, not just fairness: a bot-wide quarantine fails EVERY DM with 20026, so keying on it would false-flag the entire userbase as undeliverable in a single event. 50278/50007 are per-user signals caused by the user's own action, so they can never fire en masse from one bot-side event. (20026 is separately reclassified as `bot_level` in `dmErrorClassifier` — a filed Quick Win.)

### The daily job (180-day threshold), two branches

1. **Unreachable** (`dmUndeliverableSince` set) + `lastActiveAt` older than 180d → **purge** (full account deletion via `AccountDeletionService`). No archive — the user can't be reached.
2. **Reachable** + `lastActiveAt` older than 180d → **notify + offer a full data export (`AccountExportJob`) + grace window** → purge only if still inactive at grace-end. If the notify-DM SEND itself fails, route to the unreachable branch — no ghost state where a user silently misses their notice (council: 50278-only + DM-send-failure was the sharpest gap).

### Safety (non-negotiable)

- **Circuit breaker**: any run that flags more than a bounded fraction of the userbase (threshold TBD, e.g. 2–5%) HALTS and pages the operator instead of executing — catches a `lastActiveAt`-stops-updating gateway/intent glitch or any mass-flag cause (the general form of the 20026 concern).
- **Manual-approval first**: the job posts a "would purge N / notify M" report to the owner channel; the operator approves; then it acts. Flip to autonomous-with-circuit-breaker later (not indefinite manual — council: a stalled operator delays the promised purge).
- **Dry-run preview**: `pnpm ops retention:preview` shows the eligible set anytime, mutating nothing.
- **Purge completeness**: `AccountDeletionService` already deletes the `memory` table (pgvector embeddings are columns on it), conversation history, facts, personas, characters, pending memories, diagnostic logs, and the user row. DB backups retain deleted rows until their own TTL rolls off (acceptable; note in the privacy policy if a retention claim is made).
- **Privacy policy**: document the 180-day window at `/privacy` — "accounts inactive 180+ days that we cannot reach are purged; reachable inactive accounts are notified with an export offer and a grace period first."

## Council record (trio, 2026-07-23 — GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max)

**Adopted:** (1) flat-90d-full-wipe too aggressive → owner chose single 180d; (2) `50278`-only underinclusive → added `50007` + notify-send-failure re-routes to unreachable; (3) circuit breaker for mass-flag runs; (4) backfill `lastActiveAt` from history instead of ship-time (zombie-cohort fix); (5) a sent DM is not received notice — grace should not start purely on send (soften notice / prefer explicit user action); (6) export-delivery caveats (25MB DM cap, link expiry) → verify `AccountExportJob` delivery before the reachable branch relies on it.

**Declined / deferred:** tiered-by-category and cold-storage-lifecycle retention (council-recommended, more data-minimization-correct / better-UX respectively) — owner chose the single-window model for solo-operator simplicity. Revisit if the flat window proves too blunt.

## Phasing (multi-PR)

1. **Tracking**: schema (`lastActiveAt`, `dmUndeliverableSince`) + migration + historical backfill; central activity stamp; undeliverable stamp on 50278/50007 in the DM-failure path; clear-on-reach. (No purge yet — just start the clock.)
2. **Preview + unreachable purge**: `retention:preview` (dry-run) + the daily job's unreachable branch behind manual approval. The 26 become the first real preview batch at ship+their-backfilled-180d. → **detailed design ACCEPTED**: [`inactivity-retention-purge-phase2.md`](inactivity-retention-purge-phase2.md) (+ prerequisite Phase 1.5 [`conversation-history-sync-unification.md`](conversation-history-sync-unification.md)).
3. **Reachable branch**: notify + `AccountExportJob` offer + grace + notify-send-failure re-route; circuit breaker.
4. **Privacy policy + autonomous flip** (autonomous-with-circuit-breaker once trusted).

## Open calls deferred to later phases

- **Discord `10013` (deleted account) — Phase 2 purge-branch decision.** `10013`
  (Unknown User) is in the DM permanent-failure set alongside 50278/50007, but it is
  a *different, stronger* signal: the account is gone entirely, not merely unreachable.
  Phase 1 deliberately does **not** stamp `dmUndeliverableSince` on `10013` (the
  undeliverable signal is scoped to 50278/50007). Phase 2's purge branch should decide
  whether a `10013` account warrants *immediate* purge — there is nothing to reach and
  no one to notify, so the 180-day inactivity wait buys nothing — rather than routing it
  through the standard inactivity path. Surfaced during Phase 1 grounding (2026-07-22).
  **DISPOSITIONED 2026-07-23 → Phase 2 D13**: stamp a distinct `discord_account_gone_at`
  now; immediate-purge past the 180-day wait, guarded by flag-persistence-to-the-next-run
  (a real deletion persists; a freak transient self-corrects). See the Phase 2 doc.
