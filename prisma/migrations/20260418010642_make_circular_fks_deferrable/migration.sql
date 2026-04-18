-- Make circular NOT NULL FKs DEFERRABLE so db-sync can atomically insert
-- both sides of the circle in one transaction (SET CONSTRAINTS ALL DEFERRED
-- → INSERT users → INSERT personas → COMMIT validates both FKs at once).
--
-- Two circular pairs exist in the schema post-Phase-5b (2026-04-16):
--
--   users.default_persona_id  → personas.id       (NOT NULL)
--   personas.owner_id         → users.id          (NOT NULL)
--
--   users.default_llm_config_id → llm_configs.id  (NULLABLE, but already
--                                                  in deferredFkColumns
--                                                  because of circularity)
--   llm_configs.owner_id        → users.id        (NOT NULL)
--
-- Runtime (non-sync) behavior is preserved: `INITIALLY IMMEDIATE` means
-- normal app queries still see immediate constraint enforcement. Only
-- code that issues `SET CONSTRAINTS ALL DEFERRED` inside a transaction
-- (i.e., DatabaseSyncService) gets the deferred behavior.
--
-- Prisma cannot express DEFERRABLE in schema.prisma, so this migration is
-- hand-authored. The drift-ignore infrastructure in prisma/drift-ignore.json
-- needs matching entries so `pnpm ops db:safe-migrate` doesn't treat this
-- as drift on future Prisma migrations.

ALTER TABLE "users"
  ALTER CONSTRAINT "users_default_persona_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "users"
  ALTER CONSTRAINT "users_default_llm_config_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personas"
  ALTER CONSTRAINT "personas_owner_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "llm_configs"
  ALTER CONSTRAINT "llm_configs_owner_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
