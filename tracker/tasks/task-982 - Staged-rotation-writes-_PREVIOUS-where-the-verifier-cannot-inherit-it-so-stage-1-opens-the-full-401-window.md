---
id: TASK-982
title: >-
  Staged rotation writes _PREVIOUS where the verifier cannot inherit it, so
  stage 1 opens the full 401 window
status: To Do
assignee: []
created_date: '2026-09-14 20:51'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 978000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: found by the beta.225 DEV rotation run on 2026-09-14, the first live exercise of the staged path. TASK-976 shipped dual-secret acceptance plus a staged rotation, but stage 1 writes <NAME>_PREVIOUS at the Railway SHARED (environment) tier, and Railway inherits shared variables PER SERVICE through an explicit enable list. A NEWLY created shared variable is inherited by no service until enabled for it. So the verifier redeploys WITHOUT <NAME>_PREVIOUS, config sees undefined, isValidServiceSecret correctly refuses, and every presenter still on the outgoing value gets a 401. That is the FULL window stage 1 exists to prevent, and it is strictly worse than the single-shot path it replaced.

EVIDENCE (dev, 2026-09-14, key NAMES only, no value ever read or printed):
- After stage 1 the SHARED tier held 6 keys including BOTH INTERNAL_SERVICE_SECRET and INTERNAL_SERVICE_SECRET_PREVIOUS, up from the 5 keys recorded in the TASK-963 probe. So the upsert itself worked.
- The api-gateway EFFECTIVE set held 30 keys, INTERNAL_SERVICE_SECRET only, zero keys matching _PREVIOUS. 30 is unchanged from the TASK-963 probe, so nothing was added to the verifier.
- Gateway request log 2026-09-14T20:41:03Z: Service authentication failed, name=auth-middleware, path=/api/internal/release-broadcast/reconcile, method=POST, x-service-auth present. Presented by ai-worker, which stage 1 deliberately does not redeploy and which therefore still held the outgoing value.

FIX SHAPE, two parts, both in packages/tooling/src/secrets:
1. Write <NAME>_PREVIOUS SERVICE-SCOPED to the verifier instead of at the shared tier. TASK-976 fix-shape item 4 already sanctions this: the verifier is the only service that needs _PREVIOUS, and shared vs scoped was explicitly left an implementer call. A service-scoped upsert needs no inheritance configuration at all. Stage 3 must then delete at the SAME scope.
2. Add the read-back the design is missing. After the upsert and BEFORE redeploying the verifier, re-read the verifier EFFECTIVE variable name list and REFUSE unless <NAME>_PREVIOUS is present. The service-scoped variables query returns the merged effective set, proved by this run: it returns INTERNAL_SERVICE_SECRET, which lives at the shared tier. So it answers exactly the question that decides the outcome, namely whether the service will actually see the key.

WHY THE EXISTING GATE DID NOT CATCH IT: checkDeployedCodeAcceptsPrevious proves the verifier is RUNNING code that accepts <NAME>_PREVIOUS. It never proves the VALUE reaches that code. Two independent preconditions, only one gated. Unit tests cannot see this seam either, which is why six review rounds passed over it.

Acceptance: a dev staged rotation produces ZERO authentication failures in the gateway request log across all three stages, with a presenter that was demonstrably NOT redeployed making at least one authenticated request during the stage 1 to stage 2 window; AND stage 1 refuses, before redeploying, when the verifier effective key list lacks <NAME>_PREVIOUS.

Blocks: the first prod INTERNAL_SERVICE_SECRET rotation, which is a beta.225 cut criterion. Supersedes the zero-401s acceptance clause on TASK-976, which this run did NOT meet.

GROUNDING 2026-09-14 (read of packages/tooling/src/secrets/rotate-env-stages.ts at develop 22f9a9175; cites drift, re-verify before editing). Moving the write to service scope is NOT a one-line change, because the window-DETECTION reads the same tier:

- `const windowOpen = context.sharedNames.includes(previousName)` decides whether a rotation window is open. If the upsert moves to the verifier service scope but this keeps reading the SHARED names, stages 2 and 3 both refuse with "No rotation window is open" and the rotation is unfinishable. This is the trap: it fails CLOSED and looks like a different bug entirely. Window detection must read the VERIFIER effective names, the same scope the write now targets.
- The `_PREVIOUS` upsert and the stage 3 `deleteRailwayVariable` must BOTH carry `serviceId: verifier.id`, or stage 3 deletes at a tier the value no longer lives at and the retired value is orphaned.
- `isDegenerateWindow` reads the `_PREVIOUS` VALUE to compare it against the primary. That read must move to the verifier scope too, or it reads a variable that is not there and the half-completed-stage-1 recovery path misfires.

So the fix touches four things that must move together: the upsert scope, the delete scope, the window-detection read, and the degenerate-window read. A partial move is worse than no move, because three of the four fail closed in ways that read as unrelated bugs.

The read-back assertion is the separate half and is what makes the whole class detectable: after the upsert and BEFORE the verifier redeploy, re-read the verifier EFFECTIVE key list and refuse unless `<NAME>_PREVIOUS` is present. That single check would have caught the original defect, and it also catches every partial-move mistake above.

PREMISE CORRECTION 2026-09-15 (live probe, key NAMES only): there is NO stranded `_PREVIOUS` in dev, and the live clause has NO owner prerequisite. The shared tier holds 5 keys — the TASK-963 baseline — and all seven services' effective sets contain zero keys matching `_PREVIOUS`. The inert run's stage 3 deleted it AT THE SHARED TIER using the then-current shared-scope code, and stamped the ledger (`internal-service-secret rotated 2026-09-14`), which stage 3 does only after its verifier redeploy succeeds. The note saying "dev still holds a stranded shared-tier key — delete it by hand first" (commit `560c7fa96`, and the CURRENT.md bullet, now corrected) was a CODE-READ inference drawn from the fix moving the delete to service scope: true of the NEW code, irrelevant to a row the OLD code had already removed. It was never probed and it was wrong, and it sat across three compaction summaries as an owner prerequisite. Covered by `00-critical.md` § "Code-reading is not runtime verification".

READINESS 2026-09-15 ~23:00Z, all re-verified live:
- `secrets:rotate-env --env dev --stage 1 --dry-run` prints `Deploy gate: PASS` — the verifier runs `46dba6570`, which carries `_PREVIOUS` acceptance — and the window reads CLOSED, so stage 1 would proceed normally rather than resume or refuse.
- Dev gateway log floor over 3h: 308 lines, ZERO `Service authentication failed`, zero `auth-middleware`. The one `401` substring is an epoch-ms timestamp (`1786401839581`), not a status. Without this floor a post-run "zero failures" claim could not distinguish clean from pre-existing.
- The acceptance clause "a presenter demonstrably NOT redeployed making at least one authenticated request during the stage 1 to stage 2 window" has a DETERMINISTIC source: ai-worker's `release-reconcile` job, cron `41 * * * *` (`services/ai-worker/src/index.ts`), an authenticated POST to `/api/internal/release-broadcast/reconcile` — the very call that took the 401 on 2026-09-14. Hold the window across a `:41` boundary and the evidence is produced by construction. It is the ONLY sub-daily authenticated presenter traffic: `GatewayWatchdog`'s probe is a Discord `guild.members.fetch`, and `NightlyDbSyncScheduler` makes no gateway call.
- `--yes` is REQUIRED on dev: `confirmPrompt` reads stdin through readline and would hang in a non-TTY. Prod refuses `--yes` by design, so the prod run needs a human at the keyboard regardless.

BLOCKED 2026-09-15 — OWNER DECISION: the real `secrets:rotate-env --stage 1` run is refused by the Claude Code auto-mode classifier as `[Secret-Store Writes]`, as is the names-only Railway probe (the same probe it permitted minutes earlier; the classifier is non-deterministic here). The denial is pre-execution, so nothing was written and dev is untouched. Either the owner adds a Bash permission rule, or the owner runs the three stages with `!`, waiting for each redeploy to land and crossing a `:41` between stages 1 and 2:
  `pnpm ops secrets:rotate-env --env dev --name INTERNAL_SERVICE_SECRET --stage 1 --yes`
  `pnpm ops secrets:rotate-env --env dev --name INTERNAL_SERVICE_SECRET --stage 2 --yes`
  `pnpm ops secrets:rotate-env --env dev --name INTERNAL_SERVICE_SECRET --stage 3 --yes`
Afterwards the acceptance is read by pulling the gateway log INTO A FILE and grepping it (never printing raw lines): `pnpm ops logs --env dev --service api-gateway --since 3h > <file>` then grep for `Service authentication failed`.
<!-- SECTION:DESCRIPTION:END -->
