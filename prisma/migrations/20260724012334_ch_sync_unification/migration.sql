/*
  Phase 1.5 — conversation-history sync unification.

  Makes conversation_history a normal sync table: it gains an updated_at
  last-write-wins anchor and the generalized sync_tombstone AFTER DELETE
  trigger, and its bespoke conversation_history_tombstones table is retired.

  Hand-authored: Prisma emits `ADD COLUMN ... NOT NULL` (fails on a non-empty
  table) and cannot express triggers, so the column is backfilled before it is
  made NOT NULL and the trigger + tombstone-row migration are added by hand.
*/
-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable: add updated_at nullable, backfill, then enforce NOT NULL.
-- COALESCE(deleted_at, created_at): an already-soft-deleted row must carry a
-- fresh updated_at so its deletion propagates via last-write-wins — a plain
-- created_at backfill would tie across environments and never propagate.
ALTER TABLE "conversation_history" ADD COLUMN "updated_at" TIMESTAMP(3);
UPDATE "conversation_history" SET "updated_at" = COALESCE("deleted_at", "created_at");
ALTER TABLE "conversation_history" ALTER COLUMN "updated_at" SET NOT NULL;

-- Generalized deletion ledger: hard deletes and cascades of conversation_history
-- now DELETE-propagate via sync_tombstones like memories/memory_facts, instead of
-- resurrecting from the peer environment. sync_tombstone_capture() is defined in
-- migration 20260710230428.
CREATE TRIGGER sync_tombstone_conversation_history AFTER DELETE ON "conversation_history" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');

-- Carry any in-flight bespoke tombstones into the generalized ledger so pending
-- hard-deletes still propagate after the bespoke table is dropped.
INSERT INTO "sync_tombstones" ("table_name", "row_pk", "deleted_at")
SELECT 'conversation_history', "id"::text, "deleted_at"
FROM "conversation_history_tombstones"
ON CONFLICT ("table_name", "row_pk") DO UPDATE SET "deleted_at" = EXCLUDED."deleted_at";

-- DropTable (retired: the bespoke soft-delete-time tombstone system)
DROP TABLE "conversation_history_tombstones";
