---
id: doc-30
title: 'Idea: Website: user-facing docs pages (post-release)'
type: other
created_date: '2026-07-28 11:11'
---

## Website: user-facing docs pages (post-release)

_Surfaced 2026-07-16 (owner, release prep). Not release-gating._

Extend tzurot.org beyond landing + legal to serve user-facing docs — starting with the command reference. The machinery already exists: the legal pages render repo markdown in place via the Astro content-collection glob loader (`services/website/src/content.config.ts`, base `../../docs/legal`), so a `/commands` page is the same pattern with a second collection over `docs/commands.md` (and later, feature guides under a dedicated `docs/site/` dir if the surface grows). Reuse `renderLegalDocument`'s brand-substitution pipeline for the Rotzot preview (generalize its name — it's not legal-specific once docs use it). Single source of truth stays in the repo, so the site cannot drift from the docs; the release-procedure doc sweep keeps the source itself fresh.

**Scope**: second content collection + one prose page + nav link; decide whether commands.md's GitHub-flavored tables need styling attention in the prose layout (they do — the legal retention table styling already handles it). ~half-day.

**Promote when**: post-release, once tzurot.org is live and the owner wants the docs surface.

