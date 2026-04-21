-- Enforce global-scope LlmConfig name uniqueness across admins.
--
-- PR #834 added `@@unique([ownerId, name])` which prevents a single user
-- from having two configs with the same name. The admin global-create
-- path (`isGlobal = true`) relies on app-level `checkNameExists` alone:
-- two admins creating `isGlobal=true, name="Default"` with different
-- ownerIds both satisfy the composite-unique constraint and a race
-- could slip past the app check.
--
-- This partial unique index enforces "at most one global config per
-- name" at the DB layer. Only applies to rows where `is_global = true`;
-- non-global configs continue to use the composite-unique constraint.
--
-- Prisma can't represent partial unique indexes in schema.prisma, so
-- this migration is hand-written and the index is protected in
-- prisma/drift-ignore.json.
CREATE UNIQUE INDEX "llm_configs_global_name_unique"
  ON "llm_configs"("name")
  WHERE "is_global" = true;
