/*
  Warnings:

  - You are about to drop the column `kind` on the `llm_configs` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "llm_configs_kind_idx";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex (explicit, ahead of the column drop)
-- The (kind, name) partial-unique global-name index would be cascade-dropped by
-- DROP COLUMN "kind" below, but the PGLite schema generator replays migration
-- history and cannot see column-drop cascades — the drop must be spelled out.
DROP INDEX IF EXISTS "llm_configs_global_name_unique";

-- AlterTable
ALTER TABLE "llm_configs" DROP COLUMN "kind";

-- CreateIndex
-- Rebuild the global-name uniqueness as a single namespace (its original shape,
-- before the vision-kind migration split it per-kind). Partial unique index —
-- not representable in schema.prisma; protected by drift-ignore.json. Doubles as
-- the fail-loud guard: if any cross-kind global name collision exists in the
-- target database, this CREATE fails and the migration aborts before deploy.
CREATE UNIQUE INDEX "llm_configs_global_name_unique"
  ON "llm_configs" ("name")
  WHERE ("is_global" = true);
