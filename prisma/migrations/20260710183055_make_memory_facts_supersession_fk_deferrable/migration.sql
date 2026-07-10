-- Make the memory_facts supersession self-FK DEFERRABLE so db-sync can
-- upsert fact rows in arbitrary order inside one transaction and let
-- Postgres validate every superseded_by_id pointer at COMMIT.
--
-- Why ordering can't solve this instead: supersession pointers are not
-- creation-ordered. The normal path points OLD fact → NEW fact, but the
-- revive path (a superseded fact re-asserted verbatim becomes active again)
-- flips the newer fact's superseded_by_id to point at the OLDER row. Mixed
-- directions mean no single insert order satisfies an immediate FK check.
--
-- Runtime (non-sync) behavior is preserved: `INITIALLY IMMEDIATE` means
-- normal app queries still see immediate constraint enforcement. Only code
-- that issues `SET CONSTRAINTS ... DEFERRED` inside a transaction (i.e.,
-- DatabaseSyncService's named-constraint list) gets the deferred behavior.
--
-- Prisma cannot express DEFERRABLE in schema.prisma, so this migration is
-- hand-authored, with a matching drift-ignore entry (mirrors 20260418010642).

ALTER TABLE "memory_facts"
  ALTER CONSTRAINT "memory_facts_superseded_by_id_fkey" DEFERRABLE INITIALLY IMMEDIATE;
