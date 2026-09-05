---
id: doc-98
title: 'Idea: /notifications browse and view past release notes, searchable by version'
type: other
created_date: '2026-09-05 17:59'
---


### Idea: `/notifications` browse and view past release notes, searchable by version

_Owner intake 2026-09-05 (not urgent): extend `/notifications` so a user can browse past releases, open one, and look up a specific version. Backed by what GitHub already holds for the release notes._

**Why.** Today the release notes reach a user once, as a DM that the next release replaces (`/notifications` — `view` `enable` `disable` `level` `cleanup`, see `docs/commands.md`). There is no in-Discord way to re-read an older release or find the one that changed a given command; the only surface is the GitHub releases page.

**What exists already (grounded 2026-09-05, read before designing):**

- `release_announcements` (`prisma/schema.prisma`, model `ReleaseAnnouncement`) keeps `version`, `level`, `githubReleaseId`, and the raw notes `body` for every release the announce pipeline has processed — so releases since that pipeline shipped are queryable from the database with no GitHub call. Releases from before it exist only on GitHub.
- `services/api-gateway/src/services/releaseReconcile.ts` has `createGitHubReleasesFetcher` (one page of `RELEASES_PAGE_SIZE`, Zod-validated, token optional) and the hourly reconcile that backfills announcements — the natural place to also backfill older releases if the browse should reach past the pipeline's start.
- `services/api-gateway/src/services/releaseNotes.ts` parses a body into H3 sections in document order and formats the DM within `BROADCAST_MESSAGE_MAX_LENGTH`; the same parser can render a browse detail view (sections as embed fields, the trailer as the link).

**Shape (for the scoping pass, not decided):**

- `/notifications browse` — paginated list of releases newest-first (version, date, level badge), select menu opens one; the standard `createBrowseCustomIdHelpers` / `buildBrowseButtons` utilities (`04-discord.md` § Shared Utilities), `command::action::id` custom ids, routed through `handleButton`/`handleSelectMenu`.
- `/notifications view <version>` with autocomplete over stored versions (prefix match on `v3.0.0-beta.2…`); the detail render is the DM formatter's output plus the GitHub link. `view` already exists as the preferences view — decide whether the release detail is a new subcommand name (`release`, `changelog`) or an optional `version` argument on `view`.
- Search: version prefix via autocomplete covers "a specific version"; a text search across bodies ("which release changed /history purge") is a separate, larger ask — Postgres `ILIKE` over `body` is enough at this table size, no FTS index needed. Scope it as a stretch.
- Source of truth: the database rows first, GitHub only to backfill the pre-pipeline history once (a one-off reconcile mode or an ops command), so the command never depends on a live GitHub call and never exposes a token.
- Levels: the browse can filter by the stored `level` so a `major`-only subscriber can still find minor releases.

**Open questions for the owner at scoping time:** whether pre-pipeline releases matter enough to backfill; whether body text search is in scope for the first slice; ephemeral vs public replies (release notes are public content, so a public reply is defensible — the `/notifications` family is ephemeral today).

**Size:** M (one PR for browse + view-by-version over the existing rows; backfill and text search are follow-on slices). No schema change for the first slice. Sits in the UX epic's surface standard (`doc-14`) — file the build against that theme's pattern when it is picked.
