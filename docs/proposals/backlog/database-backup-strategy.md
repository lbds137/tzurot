# Proposal: Database Backup Strategy

**Status: UN-STARTED.** Nothing in this document is implemented. It is a proposal
for what a deliberate Postgres backup posture would look like, not a description
of one that exists.

## What exists today

Verified against the repo:

- **Railway's native managed-Postgres backups** — whatever the plan currently
  provides. This is the _entire_ backup posture. Check the Railway dashboard for
  the actual cadence and retention window before relying on any assumption about
  it; the platform's tiers change and this document deliberately does not
  restate them.
- **Nothing else.** There is no `pg_dump` anywhere in the repo, no backup
  workflow under `.github/workflows/`, no backup command in the ops CLI
  (`packages/tooling/src/commands/db.ts` exposes `db:status`, `db:migrate`,
  `db:safe-migrate`, `db:deploy`, `db:inspect`, `db:check-drift`,
  `db:fix-drift`, `db:check-safety` — none of them dump or restore), and no
  external object-storage bucket.

Two things that look adjacent but are **not** backups:

- **`DatabaseSyncService`** (`services/api-gateway/src/services/DatabaseSyncService.ts`)
  reconciles dev↔prod rows by last-write-wins on `updated_at`. It is a
  bidirectional sync of a subset of tables, so a destructive change propagates
  rather than being contained. It cannot restore anything.
- **`scripts/README_BACKUP_SCRIPT.md`** documents a standalone exporter for
  pulling a user's data out of an external personality service. Unrelated to
  this database.

## Why this is worth doing

Railway's native backups are real and are better than nothing, but they are a
single-vendor, single-region, limited-retention copy with no verified restore
path. The failure modes they do not cover:

- Retention shorter than the time it takes to notice a slow data corruption.
- Loss of, or lockout from, the Railway account itself.
- A restore that turns out not to work — an untested backup is a hypothesis.

## Proposed shape

Deliberately ordered so each phase is independently valuable and none blocks on
the next.

### Phase 1 — know what the native backups actually are

Read the Railway dashboard, write down the real cadence and retention, and
confirm the one-click restore path by doing it once against a throwaway
database. This is a session's worth of work and it is the highest-value item
here, because everything below is an argument about what the native backups
_don't_ cover — and that argument needs the real numbers.

### Phase 2 — a second copy, off Railway

A scheduled `pg_dump` to object storage (R2/B2/S3 — cheapest wins; the data is
small). Two placement options, both viable:

- **GitHub Actions on a cron** — no new infrastructure, credentials live in
  repo secrets, failures surface as a red workflow. Downside: a prod
  `DATABASE_URL` in GitHub secrets widens the blast radius of a repo
  compromise.
- **A Railway cron service** — the credential stays inside the environment that
  already has it. Downside: a Railway-wide outage takes the backup job with it,
  which is one of the scenarios the second copy exists for.

Whichever is chosen, the ops-CLI rule applies: the logic goes in
`packages/tooling/` as TypeScript with tests (`.claude/rules/05-tooling.md` §
No Standalone Scripts), and the scheduler just invokes it. That also gives an
operator a manual `pnpm ops db:backup` for free.

### Phase 3 — restore drills

A backup nobody has restored is not a backup. The drill: pull the most recent
dump, restore into a scratch database, run a handful of row-count and
foreign-key assertions, drop it. Worth encoding as an ops command so the drill
is one invocation rather than a remembered sequence — remembered sequences do
not get run.

**pgvector caveat for any restore path**: the `memories.embedding` column and
the protected indexes listed in `.claude/rules/03-database.md` § Protected
Indexes must survive the round-trip. Verify the IVFFlat index exists after a
test restore — losing it degrades vector queries silently rather than loudly,
which is exactly the kind of thing a drill is for and a real incident is not.

### Not proposed: JSON exports as a backup layer

An earlier version of this document proposed weekly JSON exports committed to
git as a portability layer. That is rejected here: the data spans users,
personalities, memories with embeddings, conversation history, and encrypted
BYOK keys, and a partial export of one slice of it is a restore path that
produces a plausible-looking but wrong database. Full-fidelity `pg_dump` is the
right artifact. (User-facing data export is a separate, already-shipped
concern — it serves data-rights requests, not disaster recovery.)

## Open questions for the owner

1. **Is the native Railway backup acceptable as the whole posture?** For a
   small project this is a defensible answer, and it makes this proposal
   Phase-1-only (verify and document, build nothing).
2. **If not, where does the dump job live** — GitHub Actions or Railway cron
   (tradeoff above)?
3. **What is the acceptable data-loss window?** Everything above is sized by
   that number and it has never been stated.
