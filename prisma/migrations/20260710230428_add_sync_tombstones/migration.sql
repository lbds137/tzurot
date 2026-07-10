-- Generalized db-sync deletion ledger: hard deletes on synced tables are
-- captured by an AFTER DELETE trigger so the bidirectional sync can
-- DELETE-propagate them instead of resurrecting the row from the other side.
-- Triggers fire for Prisma deletes, manual SQL, AND cascade deletes — the
-- coverage app-code write-before-delete discipline can't provide.
--
-- Prisma cannot express functions/triggers (and migrate diff cannot see
-- them, so no drift-ignore entries are needed); this migration is
-- hand-authored, like the cache-invalidation trigger migrations.

-- CreateTable
CREATE TABLE "sync_tombstones" (
    "table_name" VARCHAR(64) NOT NULL,
    "row_pk" VARCHAR(255) NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_tombstones_pkey" PRIMARY KEY ("table_name", "row_pk")
);

-- CreateIndex (retention pruning)
CREATE INDEX "sync_tombstones_deleted_at_idx" ON "sync_tombstones"("deleted_at");

-- The capture function: TG_ARGV carries the table's SYNC_CONFIG pk columns in
-- order; row_pk joins their OLD values with '|' — byte-identical to the
-- sync's getPrimaryKey composite encoding. ON CONFLICT keeps the LATEST
-- deletion so delete -> recreate -> delete records the second deletion.
CREATE OR REPLACE FUNCTION sync_tombstone_capture() RETURNS trigger AS $$
DECLARE
  pk text := '';
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF pk <> '' THEN
      pk := pk || '|';
    END IF;
    pk := pk || COALESCE(to_jsonb(OLD) ->> col, '');
  END LOOP;
  INSERT INTO sync_tombstones (table_name, row_pk, deleted_at)
  VALUES (TG_TABLE_NAME, pk, NOW())
  ON CONFLICT (table_name, row_pk) DO UPDATE SET deleted_at = EXCLUDED.deleted_at;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- One trigger per synced table, pk columns in SYNC_CONFIG order. Excluded:
-- conversation_history (its bespoke message-tombstone system stays),
-- conversation_history_tombstones and sync_tombstones themselves (meta).
CREATE TRIGGER sync_tombstone_users AFTER DELETE ON "users" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_personas AFTER DELETE ON "personas" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_system_prompts AFTER DELETE ON "system_prompts" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_llm_configs AFTER DELETE ON "llm_configs" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_tts_configs AFTER DELETE ON "tts_configs" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_personalities AFTER DELETE ON "personalities" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_personality_owners AFTER DELETE ON "personality_owners" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('personality_id', 'user_id');
CREATE TRIGGER sync_tombstone_personality_aliases AFTER DELETE ON "personality_aliases" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_user_personality_configs AFTER DELETE ON "user_personality_configs" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('user_id', 'personality_id');
CREATE TRIGGER sync_tombstone_user_persona_history_configs AFTER DELETE ON "user_persona_history_configs" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_memories AFTER DELETE ON "memories" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_memory_facts AFTER DELETE ON "memory_facts" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
CREATE TRIGGER sync_tombstone_shapes_persona_mappings AFTER DELETE ON "shapes_persona_mappings" FOR EACH ROW EXECUTE FUNCTION sync_tombstone_capture('id');
