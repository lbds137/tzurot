# Why `db:check-safety` exists

## What it does

Scans `prisma/migrations/**/*.sql` for patterns that drop protected indexes without immediately recreating them. The protected list is **derived at load time from `prisma/drift-ignore.json`'s `protectedIndexes` array**, via the shared `protectedIndexRegistry.ts` loader — that JSON file is where you add or edit an entry. `PROTECTED_INDEXES` in the source is a computed export (the registry's entries with their patterns compiled), not a literal to edit.

Exits non-zero with a list of violating files when it finds an unbalanced drop.

**Where it actually runs**: `.husky/pre-commit` invokes it whenever a migration file is staged, and it is a step in both the `pnpm quality` chain and the CI lint job, so an unbalanced drop cannot reach `develop` through either path. It is also on the weekly `pnpm ops health` roster and available manually as `pnpm ops db:check-safety` / `pnpm check:migrations`. The hook used to hand-roll its own narrower `grep` check over two of the three protected indexes; that copy is gone — the hook calls this tool.

**What validates the registry file, and what does not**: `protectedIndexRegistry.ts` fails loud at load time on the fields it consumes — `name`, `description`, `table`, `recreateSQL`, and both patterns (including that they compile). `prisma/drift-ignore.schema.json` describes a slightly wider format and is mechanically enforced by `db/driftIgnoreSchema.test.ts`, which compiles the schema and validates the committed `drift-ignore.json` against it on every tooling test run. That test's coverage is wider than the loader's: `type` is `required` by the schema but never read by `protectedIndexRegistry.ts`, so the loader itself still doesn't gate on it — only the schema test does.

## Why it was built

The `idx_memories_embedding` index is structurally invisible to Prisma — partial-index syntax (`WHERE` clauses on indexes) and IVFFlat operator class metadata don't survive Prisma's introspection. As a result, `prisma migrate dev` tries to DROP it on every schema regeneration, because Prisma can't see why it should exist. The `prisma/drift-ignore.json` `protectedIndexes` block intercepts that DROP at migration-write time, but the post-write check is the second line of defense: if a contributor hand-writes a migration that drops the index without restoring it, this check catches it — at commit time via the hook, and again in CI for anything that bypassed it.

The incident the index is protected against is performance-critical, not data-loss-critical: dropping the IVFFlat index causes pgvector queries against `memories.embedding` to fall back to a sequential scan, which is ~100× slower than the IVFFlat lookup. On a production-sized table (~50k+ memories) this turns sub-100ms similarity searches into multi-second hangs. The kind of "everything still works, just much slower" failure mode that's hard to notice until users complain.

## Threshold rationale

Zero tolerance — any unbalanced drop fails the run. There's no "this drop is intentional, accept it" escape hatch because the protected indexes are listed explicitly in `prisma/drift-ignore.json`; if you genuinely want to drop one, you remove its entry there in a deliberate commit, then the check no longer flags it. Forcing the registry edit makes the deletion intentional — and because the same entry also carries the DROP-suppression pattern and `recreateSQL`, removing it is a single visible decision rather than three scattered ones.

The patterns are regex-matched, not parsed, but per statement: the comment-stripped file is split on `;` and each statement's whitespace is collapsed to single spaces before matching, so a DROP or CREATE spanning several lines matches like a one-line one. A recreate of the same index anywhere in the file still satisfies the create check; what per-statement matching buys is that a recreate's own WHERE must sit inside the recreate's statement — a WHERE in an unrelated statement cannot complete a non-partial recreate. The split is on every `;`, including ones inside string literals and `$$ … $$` bodies; a split mid-construct fragments the statement and fails closed — a false positive is possible, and a false negative from this path is not, because fragmenting can only remove text a pattern would need, never add it (reasoned from the split mechanism, not pinned by a test). A balanced pair is a drop statement plus a create statement for the same index anywhere in the same migration file. An entry whose recreate must carry more than the name (the partial index's `WHERE`) says so in its `createPattern`, pinning the actual predicate rather than the bare word `WHERE`; the normalized single-line statement lets a plain `.*` span it. That pin is spelling-strict — the recreate must use the `recreateSQL` wording (`WHERE "chunk_group_id" IS NOT NULL`), and Postgres-equivalent spellings of the same predicate are rejected as false positives (the safe direction). Two gaps are known and accepted: only whole-line `--` comments are stripped (a `/* WHERE chunk_group_id IS NOT NULL */` block inside a non-partial recreate would satisfy the pattern — a false-negative path the fails-closed claim above does not cover, tracked for a block-comment strip), and a mid-statement `;` in a `$$` body splits as described above. False positives in either direction are possible if someone writes very creative SQL, but the regex matches the patterns Prisma actually emits.

## Decay check

When this tool's reminder fires and you're tempted to delete it:

- Did pgvector get replaced with a different similarity backend? Delete the tool — the protected index doesn't exist.
- Did Prisma start representing IVFFlat indexes natively? Delete the tool — the regenerate-drop cycle no longer happens.
- Has the protected list grown to many indexes? Consider whether the protection mechanism should be moved to a database-level guard (e.g., a CHECK constraint or extension) instead of a SQL-file regex scan.
- Is the regex flagging false positives or missing real drops? Edit the `dropPattern`/`createPattern` strings on the relevant `prisma/drift-ignore.json` entry; don't suppress the tool wholesale.

The tool's failure mode is silent performance degradation — keep it unless one of the above applies.
