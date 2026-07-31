---
id: doc-57
title: >-
  Idea: Admin surface for scheduled-job recurrence — a settings page for the
  cron-esque jobs
type: other
created_date: '2026-07-31 00:51'
---

**Owner-requested 2026-07-30**: _"ideally an admin facing way to tweak run
recurrence for both jobs. that's a bigger item but essentially it could be one of
the admin settings pages — essentially a nice UI for our cron-esque jobs. ideally
extensible for other jobs in the future."_

"Both jobs" = the nightly db-sync (TASK-369) and the conversation-history
prune/cleanup. But the ask is explicitly for the general surface, not two knobs.

## What already exists (this is smaller than it sounds)

Three pieces are in place and were built to be reused:

1. **`createIntervalScheduler`** (`services/bot-client/src/utils/intervalScheduler.ts`)
   — the shared scheduler shape, already backing `RetentionNagScheduler`,
   `VerificationCleanupScheduler`, and `SecretRotationNagScheduler`. Daily +
   startup firing, Redis cooldown, correct stop semantics.
2. **`SYSTEM_SETTINGS_REGISTRY`** (`packages/common-types/src/schemas/api/systemSettings.ts`)
   — registry-first system settings. A new entry renders in `/admin settings`
   automatically with no UI work, and supports `liveness: 'live'` so a change
   applies without a redeploy. This is how sticker vision shipped its kill switch.
3. **`/admin settings` paged dashboard** — the existing consumer of that registry.

So the minimum viable version is: registry entries the schedulers READ at fire
time instead of hard-coded intervals. No new UI, no new persistence layer.

## The design question worth answering first

Registry entries are flat scalars. A schedule is at least an interval, and the
owner said "recurrence," which may mean cron expressions. Three options, roughly
increasing in cost:

- **Interval-only** (`everyNHours`-style integers per job). Fits the registry
  as-is, zero new machinery, no UI work. Cannot express "3am UTC on Sundays."
- **Interval + anchor hour** — two scalars per job. Still registry-shaped, and
  covers "nightly at 3am," which is probably the real ask for both named jobs.
- **Full cron expressions** — needs a parser, validation, and a next-fire preview
  in the UI (a cron field with no preview is a footgun), and probably its own
  table rather than flat registry scalars.

Recommendation to evaluate, not adopt blindly: start at interval + anchor hour.
It covers both named jobs, reuses the registry end to end, and does not commit to
a cron dialect. Promote to expressions only when a real schedule needs one.

## Extensibility — what "extensible for other jobs" should mean

The honest version is a **job registry** paralleling the settings registry: each
scheduled job declares `{ id, label, description, defaultSchedule }` in one
place, and both the scheduler wiring and the settings page derive from it. Adding
a job becomes one registry entry rather than a scheduler + a setting + a UI row
that can drift apart — the same registry-first property that makes system
settings cheap today, and a guard against the same drift class as the four
hand-synced render paths (TASK-365).

Candidates already live: db-sync (TASK-369), conversation-history cleanup, the
retention nag, verification cleanup, secret-rotation nag. Five jobs, three
different hard-coded cadences, no single place to see them.

## Scope note

Bigger than TASK-369 and should NOT block it — ship the nightly db-sync on the
existing hard-coded pattern first, then let this surface absorb its cadence. That
ordering also gives the registry a second real consumer before it is designed,
which is the difference between an abstraction with two users and one with a
hypothetical second.
