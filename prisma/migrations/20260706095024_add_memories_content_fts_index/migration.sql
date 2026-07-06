-- Hybrid retrieval: full-text search arm (memory-architecture §3.4).
-- Expression GIN index over the english tsvector of memory content — pairs with
-- the dense IVFFlat index (idx_memories_embedding) for the RRF hybrid query.
--
-- Raw-managed like the IVFFlat index: Prisma cannot represent expression
-- indexes, so this is protected by a drift-ignore.json ignorePattern and is
-- deliberately ABSENT from the PGLite test schema (the harvester only carries
-- CHECK/partial-UNIQUE/DEFERRABLE; PGLite executes the FTS query via seq scan,
-- which is correct for eval/test purposes — only the plan differs).
CREATE INDEX IF NOT EXISTS memories_content_fts_idx
ON memories USING GIN (to_tsvector('english', content));
