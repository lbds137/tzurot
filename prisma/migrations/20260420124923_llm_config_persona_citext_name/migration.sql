-- Migrate llm_configs.name and personas.name from VARCHAR(255) to CITEXT for
-- case-insensitive uniqueness per (owner_id, name). Prisma's auto-generated
-- migration here was DROP COLUMN + ADD COLUMN which would destroy all existing
-- name data and implicitly drop the unique indexes; rewritten to use
-- ALTER COLUMN ... TYPE ... USING so rows and constraints survive.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable: in-place type change preserves row data and the existing
-- (owner_id, name) unique index continues to apply. Postgres rebuilds the
-- index under the hood with the new operator class; no CREATE UNIQUE INDEX
-- needed. The pre-existing index is case-sensitive B-tree — after the type
-- flip to citext, equality checks via that index are case-insensitive.
ALTER TABLE "llm_configs" ALTER COLUMN "name" TYPE CITEXT USING "name"::CITEXT;
ALTER TABLE "personas" ALTER COLUMN "name" TYPE CITEXT USING "name"::CITEXT;
