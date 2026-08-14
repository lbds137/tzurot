# Why `db:check-safety` exists

## What it does

Scans `prisma/migrations/**/*.sql` for patterns that drop protected indexes without immediately recreating them. The protected list is **derived at load time from `prisma/drift-ignore.json`'s `protectedIndexes` array** — that file is where you add or edit an entry. `PROTECTED_INDEXES` in the source is a computed export (`loadProtectedIndexes()`), not a literal to edit.

Exits non-zero with a list of violating files when it finds an unbalanced drop.

**Where it actually runs**: the weekly `pnpm ops health` roster, and manual `pnpm ops db:check-safety` / `pnpm check:migrations`. It is **not** wired into `pnpm quality`, CI, or `.husky/pre-commit`. The pre-commit hook hand-rolls its own `grep`-based drop-without-recreate check over a subset of these indexes, which is a separate, unsynced copy rather than a call to this tool.

## Why it was built

The `idx_memories_embedding` index is structurally invisible to Prisma — partial-index syntax (`WHERE` clauses on indexes) and IVFFlat operator class metadata don't survive Prisma's introspection. As a result, `prisma migrate dev` tries to DROP it on every schema regeneration, because Prisma can't see why it should exist. The `prisma/drift-ignore.json` `protectedIndexes` block intercepts that DROP at migration-write time, but the post-write check is the second line of defense: if a contributor hand-writes a migration that drops the index without restoring it, this check catches it. Note the "Where it actually runs" caveat above — that second line of defense is currently a weekly report and a manual command, not a merge gate.

The incident the index is protected against is performance-critical, not data-loss-critical: dropping the IVFFlat index causes pgvector queries against `memories.embedding` to fall back to a sequential scan, which is ~100× slower than the IVFFlat lookup. On a production-sized table (~50k+ memories) this turns sub-100ms similarity searches into multi-second hangs. The kind of "everything still works, just much slower" failure mode that's hard to notice until users complain.

## Threshold rationale

Zero tolerance — any unbalanced drop fails the run. There's no "this drop is intentional, accept it" escape hatch because the protected indexes are listed explicitly in `prisma/drift-ignore.json`; if you genuinely want to drop one, you remove its entry there in a deliberate commit, then the check no longer flags it. Forcing the registry edit makes the deletion intentional — and because the same entry also carries the DROP-suppression pattern and `recreateSQL`, removing it is a single visible decision rather than three scattered ones.

The recreation pattern is regex-matched, not parsed, so `CREATE INDEX … idx_memories_embedding …` anywhere in the same migration file counts as a balanced pair. False positives in either direction are possible if someone writes very creative SQL, but the regex matches the patterns Prisma actually emits.

## Decay check

When this tool's reminder fires and you're tempted to delete it:

- Did pgvector get replaced with a different similarity backend? Delete the tool — the protected index doesn't exist.
- Did Prisma start representing IVFFlat indexes natively? Delete the tool — the regenerate-drop cycle no longer happens.
- Has the protected list grown to many indexes? Consider whether the protection mechanism should be moved to a database-level guard (e.g., a CHECK constraint or extension) instead of a SQL-file regex scan.
- Is the regex flagging false positives or missing real drops? Edit the `dropPattern`/`createPattern` strings on the relevant `prisma/drift-ignore.json` entry; don't suppress the tool wholesale.

The tool's failure mode is silent performance degradation — keep it unless one of the above applies.
