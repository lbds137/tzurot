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

Mints a new 32-byte key, then sets `API_KEY_ENCRYPTION_KEY` (new) and
`API_KEY_ENCRYPTION_KEY_PREVIOUS` (old) on **both** api-gateway and ai-worker.

**Wait for both redeploys to finish before running stage 2.** A service still
running on the old process doesn't know the new key yet.

Stage 1 refuses to run if `PREVIOUS` is already set — that would demote the
current key and discard the real previous one, permanently orphaning any row
still on it. Finish the open window (stages 2 then 3) first.

### Stage 2 — reencrypt

Sweeps both tables, re-encrypting every row that still decrypts under the
previous key, then verifies. Per-table tally:

- `re-encrypted` — migrated to the new key.
- `already current` — nothing to do.
- `changed concurrently` — a user updated or deleted the row mid-sweep. Skipped,
  never overwritten; a re-run reclassifies them (a mid-window user write already
  used the current key).
- `unreadable` — matches **neither** key. Triage these before finalizing; they
  are pre-existing corruption or ciphertext from a key no longer held.

Stage 2 is idempotent. Re-run it until the verify reports zero rows off the
current key.

### Stage 3 — finalize

Re-verifies, then clears `PREVIOUS` on both services (set to `""` — the Railway
CLI cannot delete variables, and the runtime treats empty as unset) and stamps
the ledger. It **refuses to finalize** while any row still fails to decrypt with
the current key, and equally if a read hit the 50,000-row cap, since a capped
sweep cannot prove completeness.

## Safety properties worth knowing

- **Split-brain guard**: every stage first asserts that api-gateway and ai-worker
  agree on both key variables, and aborts otherwise. If a previous variable write
  partially failed, re-set the variable on the lagging service (Railway's
  dashboard history holds the values) and re-run the stage.
- **Optimistic concurrency**: the re-encrypt write matches the full snapshot
  ciphertext, not just the row id, so a concurrent user write is never clobbered.
- **Secret values never reach stdout** — only names, counts, and confirmations.
  Known limitation: `railway variables --set` has no stdin form, so key material
  transits the process's argv for the duration of the call.

## If the key is compromised

1. Run the staged rotation immediately — it does not require unsetting anything
   first, and the dual-key window means no user-visible downtime.
2. Notify affected users that their **provider** keys (OpenRouter, OpenAI, …)
   may be exposed and should be rotated at the provider.
3. Rotating our encryption key protects future ciphertext; it does not un-expose
   plaintext an attacker already extracted. Step 2 is the one that matters to
   users.

## Related

- `.claude/rules/05-tooling.md` § Secret Rotation — the command surface and the ledger's role
- [Railway Operations](../deployment/RAILWAY_OPERATIONS.md)
