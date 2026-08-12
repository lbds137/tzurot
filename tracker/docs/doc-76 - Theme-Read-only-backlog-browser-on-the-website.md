---
id: doc-76
title: 'Theme: Read-only backlog browser on the website'
type: other
created_date: '2026-08-12 22:59'
---

### Theme: Read-only backlog browser on the website

_Focus: a hosted, read-only dashboard over the tracker/backlog so the owner (and any curious visitor) can navigate and visualize project state without poking around GitHub's file browser._

#### Why (owner dictation 2026-08-12)

"It's a little bit annoying for me to navigate GitHub and poke around and look at all the files we have... primarily it would be for me, for my sake, to have a better understanding and visualization of where we're at the project." Open-source repo, everything already public and source-controlled, strictly read-only — a navigation/visualization layer, not a new data surface. GitHub Issues were considered and not adopted (the tracker/ store + backlog/ files won); this theme does NOT revisit that decision.

#### Shape sketch (unresearched — verify at pickup)

- **Data source**: `tracker/tasks/`, `tracker/docs/`, `backlog/*.md` — all markdown with frontmatter, already parsed by the Backlog.md CLI and `backlogLint.ts` (reuse their parsing, never fork it).
- **Candidate approaches, cheapest first**:
  1. Static generation at website build time (the website already Docker-builds from the repo, so the tracker files are RIGHT THERE at build) — a build step renders task/doc/board pages; zero runtime, zero auth, auto-updates on every develop push via the existing website auto-deploy.
  2. The Backlog.md CLI's own built-in web UI, if hostable read-only (probe: it exists for local use; whether it can run headless/read-only on Railway is unverified).
  3. Client-side app fetching raw files from GitHub (no build step, but rate limits + slower).
- **Views the owner actually wants**: per-area counts (the digest, rendered), the size/state/priority matrix, aging surface (oldest-N), theme/epic docs rendered with their phase checklists, and a task detail view. Search across titles.
- **Non-goals**: writes of any kind, auth, comments, GitHub Issues migration.

#### Owner design decision (2026-08-12): branch-keyed per brand

Tzurot (prod site) renders the backlog from **main**; Rotzot (dev brand) renders from **develop** — "that would line up with how the website already works / gets deployed." With the static-gen approach this is free: each deployment builds from its own branch's checkout, so the branch keying needs no fetch layer at all.

**Staleness asymmetry: SETTLED (owner, 2026-08-12) — accepted as a feature.** The backlog's living truth is on develop (tracker filings/status changes are develop-direct commits; main receives them only at release merges), so the prod/Tzurot view lags by release cadence while Rotzot updates within minutes of every filing. Owner call: that's fine — prod = stable released-state of the plan, Rotzot = the living board (the one the owner personally uses). No runtime-fetch layer; pure static-gen per branch. Do not reopen at pickup.

#### Phases (rough)

- Phase 0 — probe the Backlog.md web UI option; if dead, spike the static-gen route (a page or two from real tracker data).
- Phase 1 — board + task list + task detail, deployed on the existing website.
- Phase 2 — digest/aging/matrix visualizations; theme-doc rendering.

Filed per the granularity ladder as a theme (its own epic, multi-phase); queue bullet added to `backlog/cold/queue.md`.