-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- Pre-flight: fail loudly if any existing (owner_id, name) duplicates would
-- violate the new UNIQUE INDEX. Application-level `checkNameExists` should
-- have prevented these, but a historical race could have let them through.
-- If this fires, resolve manually (rename the older duplicate) before retrying.
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT owner_id, name
    FROM llm_configs
    GROUP BY owner_id, name
    HAVING count(*) > 1
  ) t;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot add UNIQUE(owner_id, name) on llm_configs: % duplicate (owner_id, name) group(s) exist. Resolve manually before migrating.', dup_count;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "llm_configs_owner_id_name_key" ON "llm_configs"("owner_id", "name");
