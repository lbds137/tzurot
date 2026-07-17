# Release Notifications

End-to-end reference for the release-notes DM system: how a GitHub release
becomes a set of Discord DMs, how delivery is tracked, and how the pipeline
heals when something crashes mid-flight.

## Pipeline overview

```
GitHub release:published
        │  (HMAC webhook — primary trigger)
        ▼
api-gateway /webhooks/github/release ──► changelog classifier (level: major/minor/patch)
        │                                          │
        ▼                                          ▼
   enqueueBroadcast ◄──────────────── hourly reconcile sweep (fallback puller)
        │
        ├─ release_announcements row (unique version = idempotency backbone)
        ├─ release_delivery_log rows (one per recipient, status 'pending')
        └─ BullMQ release-broadcast batches (≤50 recipients each)
                    │
                    ▼
bot-client DM worker (single replica, concurrency 1)
        ├─ /pending pre-filter (stall-rerun double-DM guard)
        ├─ delete previous release DM (one standing note per user)
        ├─ send at ~1 DM/sec, opt-out footer appended
        └─ report each outcome immediately → /deliveries ledger
                    │
                    ▼
completion: the report that transitions the last pending row flips
completedAt and carries the final tally → bot-client posts one silent
ops embed to the owner channel (FEEDBACK_CHANNEL_ID)
```

## Eligibility (who gets a DM)

All three must hold at enqueue time (`resolveEligibleRecipients`):

1. `notifyEnabled: true` — the `/notifications disable` opt-out flag.
2. `notifyOptedInAt` is non-null — the **deliberate-use gate**. A `users` row
   alone means the bot has _seen_ someone (extended-context participants get
   provisioned rows); only deliberate use stamps the timestamp: a successful
   generation (ai-worker), BYOK key setup, or an explicit `/notifications`
   preference update. Passive bystanders are never eligible.
3. `notifyLevel` at or above the release's classified level. Default `major`
   (breaking releases only); users opt up with `/notifications level`.

Levels are classified from the Conventional-Changelog release notes: Breaking
Changes → major, Features → minor, fixes-only → patch.

## Delivery ledger

`release_delivery_log` is the source of truth, not worker memory: one row per
(release, user), `pending` → `sent` / `failed_transient` / `failed_permanent`.
Two consecutive permanent failures auto-disable the user's notifications
(closed DMs stay closed — stop knocking). The `sentMessageId` on a sent row is
the user's **standing DM**: `/notifications cleanup` deletes it on request,
and the next blast's worker deletes it before sending the replacement.

## Self-healing (the two reconcile sweeps)

Both run in api-gateway, triggered hourly by ai-worker's scheduler through
`POST /api/internal/release-broadcast/reconcile` (service-auth; accepts
`lookbackHours` ≤ 168 for manual catch-up):

- **Missing announcement** — a GitHub release with no announcement row
  (missed webhook, deploy-window race) is announced, capped at 3 per run.
- **Announced but incomplete** — an announcement with `completedAt: null`
  older than 30 minutes is wedged, not live. Zero ledger rows → stamped
  complete with a loud error log (never auto-re-blasted; `/admin broadcast`
  is the manual path). Zero pending rows → stamped complete (a crash between
  the last transition and the stamp). Pending rows → rows whose user is no
  longer eligible (opted out, auto-disabled, or raised their level above
  this release) are terminalized (`opted_out`), the rest re-enqueued as
  fresh batches. Delivery is thereby at-least-once: a row whose report was
  permanently lost gets re-DMed rather than silently dropped — the accepted
  trade, bounded by the worker's /pending pre-filter and single-replica
  topology.

## Retention

Daily scheduled job (`cleanup-notifications-retention`), 90-day handled-only:

- `user_feedback`: purged only once `read`/`archived`; untriaged (`new`) rows
  are kept until the owner handles them.
- `release_delivery_log`: settled rows only — pending rows and standing-DM
  rows (sent, message not yet deleted) are always exempt.
- `release_announcements`: never purged (re-announce idempotency).

## Ops surfaces

- `/admin broadcast` — owner-only ad-hoc blast with `dry-run` (audience
  preview) and a `confirm:true` double-key; labels may not look like release
  tags (that namespace belongs to GitHub announcements).
- Completion embed — one per worker-completed blast in the owner channel:
  version, sent, permanent-failed, transient-failed (+ opted-out exclusions
  when the resweep terminalized any). The same tally is logged at the gateway
  at flip time (the durable record; the embed is best-effort). A blast whose
  completion was stamped by the resweep itself logs its full tally at the
  gateway instead — no embed, because the stamp consumes the completion flip
  and the sweep has no Discord client.
- Ledger queries — `release_delivery_log` by `releaseId` for per-recipient
  outcomes and error codes.

## User surfaces

`/notifications view|enable|disable|level` (preferences, all of which stamp
deliberate use) and `/notifications cleanup` (delete standing release DMs).
Every release DM footer names all three affordances.
