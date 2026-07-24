# Phase 1.5 — Conversation-History Sync Unification (retire the bespoke tombstone)

**Status:** ACCEPTED 2026-07-23 (owner + council i/ii/iii → iii + an audit of all five CH update sites). A **prerequisite slice** for [`inactivity-retention-purge-phase2.md`](inactivity-retention-purge-phase2.md) (its purge relies on CH cascade-deletes being sync-safe), but independently valuable — it also closes the same resurrection gap in the *existing* self-serve account delete.

**Provenance:** code-archaeology grounding + a design council (i/ii/iii → **iii**, GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max, 2026-07-23) + an empirical audit of every `conversation_history` UPDATE site. Owner-directed goal: **one tombstone mechanism, not two.**

## Why

`conversation_history` is the only sync-tracked table that (a) has **soft-deletes** (an `UPDATE` setting `deletedAt` when a message is deleted on Discord) and (b) lacks an **`updatedAt`** column. Because of (b), column-level last-write-wins can't propagate a soft-delete (both-sides row, `created_at` ties → "same" → no write), so a **bespoke `ConversationHistoryTombstone`** system exists solely to carry soft-deletes across environments. That bespoke system:

- carries three columns (`channelId`, `personalityId`, `personaId`) that are **never read**;
- **defeats the 30-day soft-delete grace period** (its apply path hard-deletes soft-deleted rows on both envs at the next sync);
- and — because `conversation_history` is *excluded* from the generalized `sync_tombstones` AFTER-DELETE trigger — leaves a **latent resurrection gap**: a cascade-delete of CH (an account purge, **or the existing self-serve `/settings data delete`**) writes *neither* kind of tombstone, so the peer env resurrects the rows on the next sync. `memories`/`memory_facts` *do* carry the generalized trigger, so a delete would leave chat history resurrected while facts stay gone — the asymmetry is the tell that the exclusion is a gap, not a design. _(Code-read-inferred; the round-trip test below is what runtime-confirms it.)_

## Decision: (iii) — add `updatedAt`, make CH a normal sync table

Council rejected **(i)** (extend the shared apply path — unanimously a *fake* unification: the "delete a both-sides row on a fresh tombstone" rule is provably CH-specific and pollutes the shared path). Between **(ii)** (drop the soft-delete tombstone; soft-deletes propagate at hard-delete, ≤30d later) and **(iii)** (add `updatedAt`), the council went 2–1 for (iii), conditioned on one code fact: *no CH update path writes something non-semantic that bumps `updatedAt`*.

**Audit result (the condition is satisfied).** All five `conversation_history` UPDATE sites, zero raw-SQL:

| Site | Writes | Class |
| --- | --- | --- |
| `ConversationSyncService.softDeleteMessages` | `deletedAt` | Semantic (heal-on-read) — *should* bump & win LWW |
| `ConversationSyncService.updateMessageContent` | `content`, `tokenCount`, `editedAt` | Semantic (heal-on-read Discord edit) — *should* bump & win |
| `ConversationHistoryService:198` | enriched `content`, `tokenCount` | Creation-lifecycle enrichment (benign) |
| `ConversationHistoryService:350` | `discordMessageId` (chunk IDs) | Creation-lifecycle (post-send, benign) |
| `referenceImageDescriptions:121` | `messageMetadata` (image descriptions) | Creation-lifecycle enrichment (benign) |

The two heal-on-read writes are exactly the semantic reconciliations (iii) *relies on*. The other three fire once at message creation, before any soft-delete, and dev has no organic traffic to re-trigger them post-soft-delete. **No ongoing per-read non-semantic write exists** — so (iii) does not bite. It's the root-cause fix and the one truly-uniform mechanism.

## Implementation

1. **Schema** (`prisma/schema.prisma`, `ConversationHistory`): add `updatedAt DateTime @updatedAt @map("updated_at")`. Prisma auto-bumps it on every `update` and sets it on `create`.
2. **Migration** (hand-authored — trigger + backfill can't be prisma-generated; mirror the `20260710230428` style):
   - `ALTER TABLE conversation_history ADD COLUMN updated_at TIMESTAMPTZ;`
   - **Backfill** `UPDATE conversation_history SET updated_at = COALESCE(deleted_at, created_at);` — the `COALESCE` is load-bearing (Kimi): an already-soft-deleted row must carry a *fresh* `updated_at` or its `deletedAt` never propagates.
   - `ALTER TABLE conversation_history ALTER COLUMN updated_at SET NOT NULL;`
   - Add the generalized trigger: `CREATE TRIGGER sync_tombstone_conversation_history AFTER DELETE ON "conversation_history" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');`
   - **Migrate in-flight bespoke tombstones** so pending hard-deletes still propagate after the bespoke table is gone: `INSERT INTO sync_tombstones (table_name, row_pk, deleted_at) SELECT 'conversation_history', id, deleted_at FROM conversation_history_tombstones ON CONFLICT DO NOTHING;`
   - Drop the bespoke table: `DROP TABLE conversation_history_tombstones;`
3. **Sync config** (`syncTables.ts`): add `updated_at` to CH's synced column set + make it the LWW anchor; remove the `created_at`-fallback special-case. Remove `'conversation_history'` from `TOMBSTONE_TRIGGER_EXEMPT` (`syncValidation.ts`) so the drift-guard now *enforces* the trigger.
4. **Delete the bespoke code:** the `ConversationHistoryTombstone` model; `tombstoneUtils.ts` (`loadTombstoneIds`, `deleteMessagesWithTombstones`); the `shouldSkipTombstones` branch in `scanTable`; the `conversation_history` special-case block in `DatabaseSyncService`; the tombstone-`createMany` in `ConversationSyncService.softDeleteMessages` (keep the `deletedAt` updateMany) and in `ConversationRetentionService` (keep the `deleteMany`); `cleanupOldTombstones`.
5. **No changes to the 5 update sites** — `@updatedAt` auto-bumps them; semantic ones win LWW correctly, enrichment ones are creation-lifecycle-benign (per the audit). Verify the append/`create` path sets `updatedAt` (Prisma does this automatically).
6. **PGLite schema regen** (`pnpm ops test:generate-schema`) + commit.

## Test (the confirmation)

A sync round-trip integration test proving all three, on real PGLite/DB:
- a **soft-delete** on env A propagates to env B via `updatedAt` LWW (B's row ends `deletedAt`-set);
- a **hard-delete** on env A propagates via the new trigger (B's row gone, **not resurrected**);
- an **account-delete cascade** (`AccountDeletionService.deleteAccount`) of a user's CH no longer resurrects on the next sync — the headline gap closed.

This test is what turns the code-read-inferred resurrection bug into a runtime-confirmed fix (per `/tzurot-bug-remediation` step 1).

## Guard (nice-to-have)

A lightweight test asserting no CH write path issues a non-semantic `updatedAt` bump — or lean on the existing `03-database.md` sync-LWW discipline rule (high-frequency/non-semantic writes to a sync-tracked table use raw SQL). The current audit shows zero violating writes; this guards the *next* one.

## Sequencing

Ships **before** Phase 2's purge (PR-D), since the purge relies on CH cascade-deletes being sync-safe. Independently shippable and valuable now — it also closes the resurrection gap in today's self-serve `/settings data delete`. After it lands, Phase 2's **D8 collapses** to "CH is a normal sync table — the generalized mechanism covers it, no special-casing."

## Backlog absorption (at landing)

- Phase 2 artifact D8 → "resolved by Phase 1.5" (edit already staged).
- `active-epic.md` → add Phase 1.5 as a prerequisite slice ahead of Phase 2's purge PRs.
- `guard:proposal-links`: inbound link from the Phase 2 artifact + active-epic.
