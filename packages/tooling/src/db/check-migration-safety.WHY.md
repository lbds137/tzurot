# Why `db:check-safety` exists

## What it does

Scans `prisma/migrations/**/*.sql` for patterns that drop protected indexes without immediately recreating them. The protected list is **derived at load time from `prisma/drift-ignore.json`'s `protectedIndexes` array**, via the shared `protectedIndexRegistry.ts` loader — that JSON file is where you add or edit an entry. `PROTECTED_INDEXES` in the source is a computed export (the registry's entries with their patterns compiled), not a literal to edit.

Exits non-zero with a list of violating files when it finds an unbalanced drop.

**Where it actually runs**: `.husky/pre-commit` invokes it whenever a migration file is staged, and it is a step in both the `pnpm quality` chain and the CI lint job, so an unbalanced drop cannot reach `develop` through either path. It is also on the weekly `pnpm ops health` roster and available manually as `pnpm ops db:check-safety` / `pnpm check:migrations`. The hook used to hand-roll its own narrower `grep` check over two of the three protected indexes; that copy is gone — the hook calls this tool.

**What validates the registry file, and what does not**: `protectedIndexRegistry.ts` fails loud at load time on the fields it consumes — `name`, `description`, `table`, `recreateSQL`, and both patterns (including that they compile). `prisma/drift-ignore.schema.json` describes a slightly wider format for editors and is **not run by anything** — no CI step, no test, and `ajv` is not a direct dependency. So `type` is `required` by the schema and read by nobody: dropping it breaks the schema while every automated gate stays green. Enforcing the schema mechanically would be a new validation tier rather than a gap to backfill, and is tracked separately.

## Why it was built

The `idx_memories_embedding` index is structurally invisible to Prisma — partial-index syntax (`WHERE` clauses on indexes) and IVFFlat operator class metadata don't survive Prisma's introspection. As a result, `prisma migrate dev` tries to DROP it on every schema regeneration, because Prisma can't see why it should exist. The `prisma/drift-ignore.json` `protectedIndexes` block intercepts that DROP at migration-write time, but the post-write check is the second line of defense: if a contributor hand-writes a migration that drops the index without restoring it, this check catches it — at commit time via the hook, and again in CI for anything that bypassed it.

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
