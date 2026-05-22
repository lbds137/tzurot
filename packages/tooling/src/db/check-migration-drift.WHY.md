# Why `db:check-drift` exists

## What it does

Compares the SHA-256 checksum of every file in `prisma/migrations/**/*.sql` against the corresponding `checksum` column in the database's `_prisma_migrations` table. Reports any migration whose file content has been edited after Prisma applied it. Local-environment only — for Railway environments, `db:status` shows the same drift via Prisma CLI.

## Why it was built

Prisma tracks the SHA-256 of every migration as it applies it. If a contributor edits an applied migration file — even by adding a comment — `prisma migrate deploy` will refuse to apply it on the next environment and report "migration was modified after it was applied." That's a hard stop on the entire migration pipeline. The fix is either to revert the edit or to use `db:fix-drift` to re-checksum the row.

The drift-check exists to surface this before it blocks a deploy. Common causes that get caught here:

- A prettier or lint-staged pass touched whitespace in `prisma/migrations/<name>/migration.sql`
- Someone tried to "fix" a typo in an applied migration instead of writing a follow-up migration
- Merge-conflict resolution mangled a migration SQL file
- The `prisma/drift-ignore.json` post-processor re-wrote a SQL file after the migration was already in the database

Detection is cheap (read each file, hash it, compare against the DB row); the failure mode is expensive (entire migration pipeline rejected at next deploy, including unrelated migrations stacked after the drifted one).

## Threshold rationale

Zero tolerance — any checksum mismatch is reported. The check doesn't have a baseline because there's no useful "approaching drift" state — a file either matches or it doesn't.

The fix path matters: `db:fix-drift` updates the DB row's checksum to match the current file (re-acknowledging the edit). Use that ONLY after confirming the edit was actually intentional and the migration's effect on already-migrated databases is unchanged (e.g., adding a comment, fixing whitespace) — never use it to paper over a semantic SQL change.

## Decay check

When this tool's reminder fires:

- Did the project switch off Prisma? Delete the tool.
- Does CI now run `prisma migrate deploy` against a throwaway DB on every PR (which would surface the same problem natively)? Delete the tool — CI catches it earlier.
- Is the local-only restriction causing friction? Either extend it to Railway environments (would require fetching the `_prisma_migrations` table over the Railway connection) or fold it into `db:status`.

Keep the tool if migration-file edits are still possible and the cost of a blocked deploy still bites.
