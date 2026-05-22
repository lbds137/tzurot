# Why `db:check-safety` exists

## What it does

Scans `prisma/migrations/**/*.sql` for patterns that drop protected indexes without immediately recreating them. Currently checks one protected index — `idx_memories_embedding`, the IVFFlat vector index for BGE similarity search — but the list is extensible via `PROTECTED_INDEXES` at the top of the source file.

Runs in pre-commit (via `.husky/pre-commit`) and CI. Exits non-zero with a list of violating files when it finds an unbalanced drop.

## Why it was built

The `idx_memories_embedding` index is structurally invisible to Prisma — partial-index syntax (`WHERE clauses on indexes) and IVFFlat operator class metadata don't survive Prisma's introspection. As a result, `prisma migrate dev`tries to DROP it on every schema regeneration, because Prisma can't see why it should exist. The`prisma/drift-ignore.json` `protectedIndexes` block intercepts that DROP at migration-write time, but the post-write check is the second line of defense: if a contributor hand-writes a migration that drops the index without restoring it, the check fails CI before the migration ships.

The incident the index is protected against is performance-critical, not data-loss-critical: dropping the IVFFlat index causes pgvector queries against `memories.embedding` to fall back to a sequential scan, which is ~100× slower than the IVFFlat lookup. On a production-sized table (~50k+ memories) this turns sub-100ms similarity searches into multi-second hangs. The kind of "everything still works, just much slower" failure mode that's hard to notice until users complain.

## Threshold rationale

Zero tolerance — any unbalanced drop fails CI. There's no "this drop is intentional, accept it" escape hatch because the protected indexes are listed explicitly in `PROTECTED_INDEXES`; if you genuinely want to drop one, you remove it from the list in a deliberate commit, then the check no longer flags it. Forcing the list edit makes the deletion intentional.

The recreation pattern is regex-matched, not parsed, so `CREATE INDEX … idx_memories_embedding …` anywhere in the same migration file counts as a balanced pair. False positives in either direction are possible if someone writes very creative SQL, but the regex matches the patterns Prisma actually emits.

## Decay check

When this tool's reminder fires and you're tempted to delete it:

- Did pgvector get replaced with a different similarity backend? Delete the tool — the protected index doesn't exist.
- Did Prisma start representing IVFFlat indexes natively? Delete the tool — the regenerate-drop cycle no longer happens.
- Has the protected list grown to many indexes? Consider whether the protection mechanism should be moved to a database-level guard (e.g., a CHECK constraint or extension) instead of a SQL-file regex scan.
- Is the regex flagging false positives or missing real drops? Edit `PROTECTED_INDEXES` regexes; don't suppress the tool wholesale.

The tool's failure mode is silent performance degradation — keep it unless one of the above applies.
