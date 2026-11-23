# Encryption Key Rotation Procedure

How to rotate `API_KEY_ENCRYPTION_KEY`, the AES-256-GCM master key that
encrypts user-supplied BYOK credentials.

**Never rotate this variable by hand.** Replacing it directly orphans every
encrypted row — the ciphertext is unrecoverable without the key it was written
under. The only sanctioned path is the staged command below, which holds both
keys while the rows migrate.

## What is encrypted

Two tables share the `iv` / `content` / `tag` column shape and both are swept by
the rotation:

- `user_api_keys` (Prisma `userApiKey`)
- `user_credentials` (Prisma `userCredential`)

Key material is 64 hex characters (32 bytes); anything else is rejected at parse
time by `parseEncryptionKeyMaterial` in
`packages/common-types/src/utils/encryption.ts`.

## When to rotate

- **Immediately** on suspected compromise.
- **Every 180 days** as routine hygiene. The rotation ledger enforces this: a
  `secret_rotations` row named `byok-encryption-key` carries a 180-day interval,
  and the bot-client's daily check posts an owner-channel nag once it goes
  overdue. `pnpm ops secrets:rotation-status --env prod` shows the ledger.

## The staged rotation

```bash
pnpm ops secrets:rotate-byok --env prod --stage 1   # stage
pnpm ops secrets:rotate-byok --env prod --stage 2   # reencrypt
pnpm ops secrets:rotate-byok --env prod --stage 3   # finalize
```

Implementation: the entry point is `packages/tooling/src/secrets/rotation.ts`; the
stage modules are in the same directory: `byok-prepare-stage.ts` (stage 1),
`byok-reencrypt-stage.ts` (stage 2) and `byok-consistency.ts` (the shared
consistency checks).

**No maintenance window is required.** During the window, services decrypt with
the current key and fall back to the previous key and, while a rotation is being
staged, to a decrypt-only `API_KEY_ENCRYPTION_KEY_NEXT` — GCM's auth tag makes a
wrong-key attempt fail loudly rather than return garbage, so try-then-fallback
is a safe key selector and no ciphertext versioning is needed. User-facing key
operations keep working throughout.

**Why `NEXT` exists.** Both services read and write encrypted rows. Promoting the
new key to `CURRENT` on one service while the other still holds only the old key
would let a row written under the new key be unreadable by the other service. So
the new key first goes in as `NEXT` on both services, which decrypts with it but
never encrypts with it; only once every process that could write is known to hold
it does stage 1 promote it.

**Precondition: deploy the `NEXT`-aware code first.** Stage 1 redeploys each
service reusing its running image, so the image already running in the target
environment must contain the `NEXT`-aware `decryptApiKey`. This tool does not
check it. Deploy to the environment before running stage 1. Until TASK-1510
adds that check, no prod BYOK rotation runs (owner ruling).

### Stage 1 — stage

Preflights that both api-gateway and ai-worker have a `SUCCESS` latest
deployment before writing anything (refusing with no changes otherwise), then:

1. **Prepare.** Stages `API_KEY_ENCRYPTION_KEY_NEXT` on both services via the
   Railway GraphQL API (`skipDeploys: true`). A valid `NEXT` that is already
   equal on both services (left by an interrupted run) and differs from `CURRENT`
   is reused; anything else is replaced by a fresh 32-byte key. Replacing is safe
   because nothing encrypts under `NEXT`.
2. **Redeploy and drain.** For api-gateway, then ai-worker: redeploy reusing the
   running image, wait for the new deployment to reach `SUCCESS`, then wait for
   the deployment it superseded to report `REMOVED`, `SKIPPED` or `FAILED` (the
   same not-live set the pre-swap check uses), so no process from before the
   redeploy is still live. A deployment that stays `CRASHED` counts as live,
   because a restart policy can revive it, so it must be removed in the Railway
   dashboard. Then, for each service, it lists the deployments
   that are not `REMOVED`, `SKIPPED` or `FAILED` and refuses unless the only one
   is the deployment this run redeployed: an older deployment still running would
   keep the old key and no `NEXT`, and could not decrypt rows written after the
   swap. After that, it re-reads the keys and refuses if `CURRENT`, `PREVIOUS` or
   `NEXT` moved while it waited. A refusal from this check changes no key; wait
   for the named older deployments to show `REMOVED`, `SKIPPED` or `FAILED` in the
   Railway dashboard (remove any that stay `CRASHED`), then re-run stage 1 (it
   reuses `NEXT`).
3. **Swap**, all `skipDeploys: true`, in a fixed order:
   `API_KEY_ENCRYPTION_KEY_PREVIOUS` (old) on both services, then
   `API_KEY_ENCRYPTION_KEY` (the staged key) on both, then delete
   `API_KEY_ENCRYPTION_KEY_NEXT` on both.
4. **Redeploy** both services reusing their running image (no rebuild; requires
   `TZUROT_RAILWAY_API_TOKEN_DEV` or `TZUROT_RAILWAY_API_TOKEN_PROD` in the local
   `.env`).

Every intermediate state still decrypts every row, so an interrupted stage 1
never strands data, and no row is touched before stage 2. This adds one restart
per service per rotation (four per service across the rotation, up from three).

Probed on dev: the `deployment(id:)` status query used by the drain returned the
requested ids with SUCCESS, SKIPPED and REMOVED, the last for a superseded
deployment. That a reuse-image redeploy picks up variables staged with
`skipDeploys` was observed once when that redeploy path was built (the note on
`redeployRailwayServiceReusingImageWithSource` in `railway-api.ts`), but it is
not pinned by a test. Both services log `byokNextKeySet` and `byokPreviousKeySet`
at startup (presence only, never a value), so a rotation can confirm from the
service logs that the prepare redeploy loaded `NEXT` before the swap: on dev,
check that line on both services before trusting stage 1. Also not verified: how
soon a superseded deployment reaches `REMOVED` (within a few seconds in two dev
observations). The drain fails closed on any
status outside `REMOVED`, `SKIPPED` and `FAILED`, on a read error, and on a
timeout, naming the service and the re-run. A timeout on a deployment that is
still `CRASHED` says so; that deployment must be removed in the dashboard first.

Because an upsert or delete that fails or times out may or may not have applied
on Railway, stage 1's failure text says what to do:

- A `NEXT` upsert failure, or a `PREVIOUS`-phase failure: re-run stage 1 (the
  re-run reuses or regenerates `NEXT`).
- A `CURRENT`-phase upsert failure: follow what the re-run reports. If it
  completes, nothing more to do; if the key differs between the services, copy it
  from api-gateway to ai-worker in the Railway dashboard, then run stage 2; if a
  rotation window is already open, run stage 2.
- A `NEXT` delete failure: every key write landed and a leftover `NEXT` equals
  `CURRENT`, so it decrypts nothing extra; run stage 2, and stage 3 deletes the
  leftover.

A re-run that finds `CURRENT` already split across the services is refused by the
consistency check, whose own message says to re-set the key on the lagging
service (the dashboard's variable history has the value), then re-run. A `NEXT`
that differs between the services does not block stage 1: it regenerates `NEXT`.

**Abort after the prepare, before the swap.** If you decide not to proceed after
`NEXT` is staged (stage 1 failed or was stopped during the drain), delete it on
both services and redeploy both; no row was ever encrypted under it:

```bash
pnpm ops deploy:var-delete --env <env> --service api-gateway --name API_KEY_ENCRYPTION_KEY_NEXT --yes
pnpm ops deploy:var-delete --env <env> --service ai-worker --name API_KEY_ENCRYPTION_KEY_NEXT --yes
pnpm ops deploy:redeploy --env <env> --service api-gateway --yes
pnpm ops deploy:redeploy --env <env> --service ai-worker --yes
```

Run stage 2 once both redeploys have settled (it refuses a deployment still in
flight); it redeploys both services again itself (see below). A service
still running on the old process doesn't know the new key yet, which is why
stage 2 does not re-encrypt until each service has a deployment it created.

Stage 1 refuses to run if `PREVIOUS` is already set to a key different from the
current one — that would demote the current key and discard the real previous
one, permanently orphaning any row still on it. Finish the open window (stages 2
then 3) first (if stage 1 itself was interrupted after its writes, run stage 2:
it redeploys both services itself; a service whose latest deployment is `FAILED`,
`CRASHED`, `REMOVED` or `SKIPPED` must be fixed in the Railway dashboard until
its latest deployment is `SUCCESS` first, because stage 2's readiness check
refuses it, and `pnpm ops deploy:redeploy` refuses it too). `PREVIOUS` equal to
the current key (on one or both services) is the degenerate window an
interrupted stage 1 leaves behind; nothing can be orphaned, so stage 1 re-runs.
A `NEXT` equal to its own service's `CURRENT` counts as unset in every stage's
checks: it decrypts nothing `CURRENT` does not. (At runtime `decryptApiKey` still
tries it after `CURRENT` fails, which repeats the same key and changes no result.)

### Stage 2 — reencrypt

Refuses if `PREVIOUS` is empty or still equals `CURRENT` (an interrupted stage
1), and preflights that both services' latest deployments are `SUCCESS`. That
preflight proves only that nothing is mid-deploy, not that the deployments
started after stage 1's writes, so stage 2 then redeploys api-gateway and then
ai-worker itself (image reused, one service at a time) and waits for each new
deployment to report `SUCCESS` before touching any row. This costs one extra
restart per service per rotation, so run stage 2 off-peak: an ai-worker restart
may interrupt its in-flight jobs.

Stage 2 refuses, with no row re-encrypted, when:

- a wait fails or times out;
- a new deployment ends `FAILED`, `CRASHED`, `REMOVED` or `SKIPPED`: it becomes
  that service's latest deployment, so the preflight refuses the next stage 2
  until you fix the service in the Railway dashboard and its latest deployment
  reaches `SUCCESS`;
- once both waits finish, api-gateway's `CURRENT` or `PREVIOUS` differs from its
  first read or is now missing;
- the check that follows finds api-gateway and ai-worker no longer agree on both
  keys (re-set the lagging service first, as the error says);
- `API_KEY_ENCRYPTION_KEY_NEXT` is set on either service to a value different
  from that service's `CURRENT`, checked before any redeploy and again after the
  waits. With no window open it is an interrupted stage 1 prepare, so re-run
  stage 1. With a window open (only reachable by a hand edit) stage 1 would
  refuse, so the error names the `pnpm ops deploy:var-delete` command for each
  affected service; run it, then re-run stage 2.

After fixing the cause, re-run stage 2: it re-reads the keys. Re-running while
the window is open repeats the restarts and the sweep; rows already on the
current key are tallied `already current`, so the repeat is harmless to the
rows (the restarts still happen).

The sweep then re-encrypts every row in both tables that still decrypts under the
previous key, and verifies. Per-table tally:

- `re-encrypted` — migrated to the new key.
- `already current` — nothing to do.
- `changed concurrently` — a user updated or deleted the row mid-sweep. Skipped,
  never overwritten; a re-run reclassifies them (a mid-window user write already
  used the current key).
- `unreadable` — matches **neither** key. Triage these before finalizing; they
  are pre-existing corruption or ciphertext from a key no longer held.

Stage 2 is idempotent for the rows, but each re-run also restarts both services,
so do not loop it during peak traffic. Re-run it until the verify reports zero
rows off the current key.

**Before stage 3, confirm one BYOK-backed request succeeds.** The sweep runs
locally in tooling, so "all rows verified on the current key" shows that the
stored rows decrypt under the current key, not that the redeployed services
decrypt with it. Stage 3 is the step that removes `PREVIOUS`, so exercise one
request that needs a stored BYOK key (for example a bot reply on a personality
using a user's own key) and check the service logs for decryption errors first.
If it fails, do not run stage 3: `PREVIOUS` is still set on both services.

### Stage 3 — finalize

Refuses before touching the database when no rotation window is open
(`API_KEY_ENCRYPTION_KEY_PREVIOUS` absent or empty on both services) or when
`API_KEY_ENCRYPTION_KEY_PREVIOUS` still equals `API_KEY_ENCRYPTION_KEY` (an
interrupted stage 1 — re-run stage 1 instead). It also refuses a
`API_KEY_ENCRYPTION_KEY_NEXT` that differs from `CURRENT`: with the window open
the error names the `deploy:var-delete` command per affected service, and on
`--resume` with `PREVIOUS` already gone it says to re-run stage 1. When a window
is open, stage 3
re-verifies, preflights that both services' latest deployments are `SUCCESS`
before mutating anything, then deletes `API_KEY_ENCRYPTION_KEY_PREVIOUS` on both
services via the Railway GraphQL API (and then any leftover
`API_KEY_ENCRYPTION_KEY_NEXT`, which by then equals `CURRENT`), redeploys both services reusing their
running image, and stamps the ledger only if both redeploys were accepted
(requires `TZUROT_RAILWAY_API_TOKEN_DEV` or `TZUROT_RAILWAY_API_TOKEN_PROD` in
the local `.env`, same as stages 1 and 2). It **refuses to finalize** while any
row still fails to decrypt with the current key, and equally if a read hit the
50,000-row cap, since a capped sweep cannot prove completeness. If an earlier
stage 3 was interrupted after `API_KEY_ENCRYPTION_KEY_PREVIOUS` was deleted from
both services (or after cleaning up a partial delete with `deploy:var-delete`),
run `pnpm ops secrets:rotate-byok --env prod --stage 3 --resume` to finish the
redeploys and ledger stamp; `--resume` is refused on stages 1 and 2 and whenever
`API_KEY_ENCRYPTION_KEY_PREVIOUS` is still set. `--resume` is taken on trust, so
running it with no interrupted stage 3 behind it stamps the ledger and resets
the 180-day reminder with no rotation having happened.

## Safety properties worth knowing

- **Split-brain guard**: every stage first asserts that api-gateway and ai-worker
  agree on `CURRENT` and `PREVIOUS` (and, for stages 2 and 3, `NEXT`), and
  aborts otherwise. If a previous variable write
  partially failed, re-set the variable on the lagging service (Railway's
  dashboard history holds the values) and re-run the stage.
- **Optimistic concurrency**: the re-encrypt write matches the full snapshot
  ciphertext, not just the row id, so a concurrent user write is never clobbered.
- **Secret values never reach stdout or argv** — writes travel in the Railway
  GraphQL API request body, and only names, counts, and confirmations are
  printed.

## If the key is compromised

1. Run the staged rotation immediately — it does not require unsetting anything
   first, and the dual-key window means no user-visible downtime.
2. Notify affected users that their **provider** keys (OpenRouter, OpenAI, …)
   may be exposed and should be rotated at the provider.
3. Rotating our encryption key protects future ciphertext; it does not un-expose
   plaintext an attacker already extracted. Step 2 is the one that matters to
   users.

## Related

- `.claude/rules/05-tooling.md` § Secret Rotation — the staged-rotation constraint; the command surface (`secrets:rotation-status`, `secrets:mark-rotated`, `secrets:rotate-byok`) and the ledger's role live in [OPS_CLI_REFERENCE.md](../tooling/OPS_CLI_REFERENCE.md) § Secrets Commands
- [Railway Operations](../deployment/RAILWAY_OPERATIONS.md)
