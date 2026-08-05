---
id: TASK-314
title: Website Railway watch patterns must cover Dockerfile-COPY content dirs
status: To Do
assignee: []
created_date: '2026-07-22 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:website'
  - 'area:docs'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 314000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-22 (owner smoke: dev site served pre-rename docs) — the website service's Railway watch patterns must cover every Dockerfile-COPY'd content path; `docs/guides/**` + `docs/commands.md` were missing, so every docs push since the beta.173 version bump was SKIPPED (deploy-side staleness; the repo content was correct). Immediate fix = dashboard watch-pattern edit (both envs) + redeploy — Dockerfile now carries the invariant as a comment. **Fix shape (structural)**: Railway config-as-code (`services/website/railway.json` with `watchPatterns`) so the list is repo-reviewed and drift-proof; needs a one-time dashboard action to point the service at the config file. **Promote when**: the watch list drifts again, or the next website-service touch.

**Why:** Dashboard edit fixes it today; config-as-code is the durable version but needs owner dashboard setup either way.
<!-- SECTION:DESCRIPTION:END -->
