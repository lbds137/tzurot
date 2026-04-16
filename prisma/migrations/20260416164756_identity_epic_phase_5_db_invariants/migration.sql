-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_default_persona_id_fkey";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- CreateIndex
CREATE UNIQUE INDEX "personas_owner_id_name_key" ON "personas"("owner_id", "name");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_default_persona_id_fkey" FOREIGN KEY ("default_persona_id") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CHECK constraints on personas.name (Identity Epic Phase 5 DB-level tripwires):
--
-- `personas_name_non_empty`: reject names that are empty or whitespace-only.
-- App-layer validation should already reject these, but this is the safety net
-- for any future code path (or direct SQL) that bypasses validation.
--
-- `personas_name_not_snowflake`: reject 17–19 digit numeric strings. This is
-- a DB-level tripwire for the Phase 1 snowflake-as-name bug class — if any
-- refactor ever accidentally wires `name = discordUserId`, the DB rejects it
-- loudly instead of silently creating a broken identity. Zero prod rows match
-- this pattern post-heal (verified empirically against prod + dev, 2026-04-16).
ALTER TABLE "personas"
  ADD CONSTRAINT "personas_name_non_empty" CHECK (LENGTH(TRIM("name")) > 0);

ALTER TABLE "personas"
  ADD CONSTRAINT "personas_name_not_snowflake" CHECK ("name" !~ '^\d{17,19}$');
