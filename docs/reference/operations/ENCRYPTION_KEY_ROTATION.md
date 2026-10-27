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

Implementation: `packages/tooling/src/secrets/rotation.ts`.

**No maintenance window is required.** During the window, services decrypt with
the current key and fall back to the previous one — GCM's auth tag makes a
wrong-key attempt fail loudly rather than return garbage, so try-then-fallback
is a safe key selector and no ciphertext versioning is needed. User-facing key
operations keep working throughout.

### Stage 1 — stage

Preflights that both api-gateway and ai-worker have a `SUCCESS` latest
deployment before writing anything (refusing with no changes otherwise), then
mints a new 32-byte key and upserts it via the Railway GraphQL API
(`skipDeploys: true`) on **both** services in a fixed order:
`API_KEY_ENCRYPTION_KEY_PREVIOUS` (old) on both services first, then
`API_KEY_ENCRYPTION_KEY` (new) on both. Every intermediate state still decrypts
every row, so an interrupted stage 1 never strands data, and no row is touched
before stage 2. Because an upsert that fails or times out may or may not have
applied on Railway, stage 1's failure text instructs to re-run stage 1 (any
`PREVIOUS`-phase failure is repaired by the re-run, and a `CURRENT`-phase
re-run classifies whether the write landed and prints the exact repair steps,
using `pnpm ops deploy:redeploy --env <env> --service <name> --yes`). It then
redeploys both services reusing their running image (no rebuild; requires
`TZUROT_RAILWAY_API_TOKEN_DEV` or `TZUROT_RAILWAY_API_TOKEN_PROD` in the local
`.env`).

Run stage 2 once both redeploys have settled (it refuses a deployment still in
flight); it redeploys both services again itself (see below). A service
still running on the old process doesn't know the new key yet, which is why
stage 2 does not re-encrypt until each service has a deployment it created.

Stage 1 refuses to run if `PREVIOUS` is already set to a key different from the
current one — that would demote the current key and discard the real previous
one, permanently orphaning any row still on it. Finish the open window (stages 2
then 3) first (if stage 1 itself was interrupted after its writes, run stage 2:
it redeploys both services itself; a service whose latest deployment is `FAILED`,
`CRASHED`, `REMOVED` or `SKIPPED` needs
`pnpm ops deploy:redeploy --env <env> --service <name> --yes` first, because
stage 2's readiness check refuses it). `PREVIOUS` equal to the current key (on
one or both services) is the degenerate window an interrupted stage 1 leaves
behind; nothing can be orphaned, so stage 1 re-runs.

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
  until you redeploy the service by hand and it reaches `SUCCESS`;
- once both waits finish, api-gateway's `CURRENT` or `PREVIOUS` differs from its
  first read or is now missing;
- the check that follows finds api-gateway and ai-worker no longer agree on both
  keys (re-set the lagging service first, as the error says).

After fixing the cause, re-run stage 2: it re-reads the keys. Re-running while
the window is open repeats the restarts and the sweep; rows already on the
current key are tallied `already current`, so the repeat is harmless.

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

Re-verifies, preflights that both services' latest deployments are `SUCCESS`
before mutating anything, then deletes `API_KEY_ENCRYPTION_KEY_PREVIOUS` on both
services via the Railway GraphQL API, redeploys both services reusing their
running image, and stamps the ledger only if both redeploys were accepted
(requires `TZUROT_RAILWAY_API_TOKEN_DEV` or `TZUROT_RAILWAY_API_TOKEN_PROD` in
the local `.env`, same as stages 1 and 2). It **refuses to finalize** while any
row still fails to decrypt with the current key, and equally if a read hit the
50,000-row cap, since a capped sweep cannot prove completeness.

## Safety properties worth knowing

- **Split-brain guard**: every stage first asserts that api-gateway and ai-worker
  agree on both key variables, and aborts otherwise. If a previous variable write
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
