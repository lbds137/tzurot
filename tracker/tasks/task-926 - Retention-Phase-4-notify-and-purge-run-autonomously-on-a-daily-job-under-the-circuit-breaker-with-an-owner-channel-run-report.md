---
id: TASK-926
title: >-
  Retention Phase 4: notify and purge run autonomously on a daily job under the
  circuit breaker, with an owner-channel run report
status: To Do
assignee: []
created_date: '2026-09-09 20:20'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 924000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the accepted retention design (docs/proposals/backlog/inactivity-retention-purge-phase2.md, What Phase 2 is and is not) scoped autonomous execution out as Phase 4 and the epic slot was released 2026-08-01 with Phase 4 parked; no task carried it, so nothing surfaced it. Since then every manual tranche has run clean with 0 skipped: 45 users 2026-07-27, 14 on 2026-09-02, 5 on 2026-09-09. The operator step is now the only thing between the daily nag and the deletion, and the owner ruled on 2026-09-09 (AskUserQuestion) to make BOTH halves autonomous in beta.222.

What: one scheduled job, mirroring the daily nag scheduler shape (daily plus startup, Redis cooldown), that runs the notify step then the purge step through the same endpoints the CLI uses, under the existing circuit breaker (warning annotation at ~15 percent of the userbase, hard ceiling at ~25 percent that even force cannot pass without the explicit override flag, which the job never sets), and posts one run-summary embed to the owner channel in the shape of the nightly db-sync report: purged, characters deleted and re-homed, skipped, notified, breaker state, plus the same per-user rows the nag posts today. The audit table and the per-user TOCTOU re-check already exist and stay in the path. Members that become real once a job and the CLI can both fire: TASK-326 (advisory lock so a scheduled run and a manual run cannot overlap) and TASK-325 (unreachability refresh only happens on notify runs, which the job now provides daily). Ergonomics found on the 2026-09-09 tranche: retention:notify prompts for production confirmation even from a non-TTY shell and exits 13 without --force, unlike the purge command; the job path must not inherit that prompt, and the CLI should fail fast naming --force the way db:safe-migrate names --name.

Acceptance: the job runs on the schedule in dev with a seeded eligible cohort and posts the report; a breaker-tripping cohort (over the hard ceiling) halts the purge half, reports the halt, and the notify half still runs; TASK-326 lock pinned by a test that runs the job while a CLI purge holds the lock; the manual CLI path keeps working unchanged; the retention calendar line in CURRENT.md records the first autonomous run. Privacy policy: the deletion-without-request statement was the PR-D gate and already landed with the first manual purge, so autonomy needs no new policy text; re-read docs/legal/PRIVACY_POLICY.md retention table before shipping to confirm.

Plan (grounded 2026-09-10): TWO PRs. PR-A (gateway safety, spec docs/local/handoffs/spec-926a-run-lease.md): a Redis run LEASE with begin and end endpoints, runId required on purge and on non-dry notify, 409 naming the holder. This replaces the advisory-lock fix shape of TASK-326, because the purge is one account per pooled HTTP call and a Postgres session lock cannot span a run. PR-A also confines non-production purges to OUTBOUND_DM_ALLOWLIST (fail closed when unset), maps P2025 to already_gone, and makes the CLI fail fast in a non-TTY without --force (the exit 13 is Node reporting an unsettled top-level await: the readline prompt waits on a closed stdin). PR-B: the bot-client job, the run report, a kill switch.

Found in grounding, fixed by PR-A: users carries an AFTER DELETE sync tombstone trigger with no suppression, so a dev purge computed on dev activity data would propagate to prod at the next nightly sync as a plain row delete (no notice, no re-homing). Code-read, and already named as a known property in the nag scheduler docstring (RetentionNagScheduler.ts, the production-only gate: "a purge whose tombstones sync straight back to prod"), which is why the nag never runs in dev. The CLI still allowed a dev purge; PR-A closes that. ACCEPTANCE CORRECTION (supersedes the dev clause above, which was written before this was known): live runs are production-only, mirroring the nag gate; in dev the job runs as a REHEARSAL (preview plus notify dry-run, nothing sent or deleted) that exercises the scheduler and report path. Seeding eligible dev accounts is ruled out because the sync would delete the same accounts in prod. The live purge path is exercised by unit tests at the service-client seam and first runs in prod, observed through its report.

PR-A MERGED 2026-09-10 as #2385 (dd8e5a853; closed TASK-326). Correction to the note above: the dev-purge propagation was NOT newly found; closed TASK-634 found it on 2026-08-16 and fixed it at the CLI (nag production-only, dev purge behind the same confirmation as prod). PR-A moved that fence to a server-side scope that holds for any caller. PR-B members added from the #2385 review: (a) warn when run/end returns released false, in the CLI helper packages/tooling/src/retention/runLease.ts AND in the job-side mirror, since a job whose lease was taken over has no operator watching; (b) the job must never treat the hard-ceiling breaker as protection for a scoped run: in a scoped environment the breaker numerator is the narrowed count over the whole userbase, so it cannot trip (live mode is production-only, where the scope is unrestricted); (c) the job renders the preview totals.scope field when it is not unrestricted.

Privacy policy re-read 2026-09-10 (docs/legal/PRIVACY_POLICY.md, Inactive accounts): erasure "may" follow the notice and 30 days, or happen without notice when unreachable; no clause requires operator approval per deletion. Autonomy needs no new policy text.
<!-- SECTION:DESCRIPTION:END -->

PR-B MERGED 2026-09-10 as #2386 (86602aebd), after 5 review rounds with no correctness finding.
- What shipped: RetentionRunScheduler, with three modes (live, nag, rehearsal), the RETENTION_AUTORUN_ENABLED kill switch defaulting to true, and the owner-channel run report. The PR-A members shipped too: the released-false warning in both lease helpers, and no reliance on the breaker for a scoped run.
- Owner rulings during review: a reconcile backlog reports, and a breaker warning alone reports.
- Round-5 lows were filed as TASK-932.
- TASK-325 is closed.
- REMAINING, the last acceptance clause: record the first autonomous run on CURRENT.md's retention calendar line. That run happens in prod about 60s after the beta.222 boot. Close this task then.
