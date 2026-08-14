---
id: TASK-314
title: Website Railway watch patterns must cover Dockerfile-COPY content dirs
status: To Do
assignee: []
created_date: '2026-07-22 00:00'
updated_date: '2026-08-14 22:47'
labels:
  - 'area:website'
  - 'area:docs'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 314000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-22 (owner smoke: dev site served pre-rename docs) — the website service's Railway watch patterns must cover every Dockerfile-COPY'd content path; `docs/guides/**` + `docs/commands.md` were missing, so every docs push since the beta.173 version bump was SKIPPED (deploy-side staleness; the repo content was correct). Immediate fix = dashboard watch-pattern edit (both envs) + redeploy — Dockerfile now carries the invariant as a comment. **Fix shape (structural)**: Railway config-as-code (`services/website/railway.json` with `watchPatterns`) so the list is repo-reviewed and drift-proof; needs a one-time dashboard action to point the service at the config file. **Promote when**: the watch list drifts again, or the next website-service touch.

**Why:** Dashboard edit fixes it today; config-as-code is the durable version but needs owner dashboard setup either way.

**DECIDED 2026-08-14 (owner, TASK-599 digest, REVISED same day): NOT railway.json - the owner recalled and git confirmed this repo removed Railway config-as-code TWICE (root railway.json at the Dockerfile migration; #1372 per-service railway.json proven unread by an SSH dry-run, replaced by ops-CLI premigrate in 0384f588c). Instead: keep dashboard-managed watch patterns + the shipped Dockerfile comment, and once TASK-62 provisions the project-scoped Railway token, add a drift guard comparing the dashboard watchPatterns against Dockerfile COPY paths (derive the fact, do not restate it). Relabeled state:dependent on TASK-62.**
<!-- SECTION:DESCRIPTION:END -->
