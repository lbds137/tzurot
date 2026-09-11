---
id: TASK-898
title: >-
  weekly-audit: Dependabot-alerts and repo-settings rows are structurally
  unavailable under GITHUB_TOKEN
status: To Do
assignee: []
created_date: '2026-09-05 13:02'
updated_date: '2026-09-11 19:26'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 896000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: The 2026-09-05 ops health run printed `Dependabot alerts open: unavailable (gh: Resource not accessible by integration (HTTP 403))` and `Repo deletion-safety settings: unavailable (repository response has no boolean delete_branch_on_merge)` with `security-events: read` already granted in `.github/workflows/weekly-audit.yml` (its comment claims that scope covers the alerts read). Both surfaces degrade honestly, but they are dead in CI every week, so the weekly run never sees an alert or a deletion-safety regression.

Premise: the Actions token has no Dependabot-alerts permission key in the workflow `permissions` vocabulary, and `delete_branch_on_merge` is returned only to admin-scoped callers. Inferred from the two observed failures plus the permissions list the workflow already grants; not probed against GitHub docs or a PAT, so treat as unverified until (a) below is tried.

Fix shape: (a) a read-only fine-grained PAT secret (Dependabot alerts: read, Administration: read, Metadata: read) exported as `GH_TOKEN` for the `pnpm ops health` step only, or (b) accept both rows as local-only (the release preflight runs `guard:repo-settings` and `security:advisories` with the owner token) and rewrite the workflow comment so it stops claiming `security-events` covers alerts.

Owner question: Create a read-only fine-grained PAT secret for the weekly audit, or accept the two rows as local-only and fix the comment?
Recommendation: (a) — the weekly run is the only unattended read of both surfaces, and a two-permission read-only PAT is a small blast radius; (b) is the fallback if the PAT proves not to unlock either row, which also settles the premise.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: owner-ruling
created: 2026-09-11 19:25
---
Owner ruling 2026-09-11: option (a), a read-only fine-grained PAT. Owner step: mint a fine-grained PAT scoped to this repository with Dependabot alerts: read, Administration: read, Metadata: read, and add it as the repository secret WEEKLY_AUDIT_TOKEN. Agent step: export it as GH_TOKEN on the ops health step with a fallback to github.token so the workflow keeps running before the secret exists, and rewrite the comment that claims security-events covers the alerts read. If the PAT does not unlock a row, fall back to (b) and record which row.
---

author: owner-ruling
created: 2026-09-11 19:26
---
Correction 2026-09-11: the workflow half is ALREADY built. weekly-audit.yml exports GH_TOKEN from secrets.WEEKLY_AUDIT_GH_TOKEN with a github.token fallback on the ops health step, and its permissions comment already names the three read scopes. The secret name is WEEKLY_AUDIT_GH_TOKEN (not the name in the previous comment). Remaining step is the owner only: mint the fine-grained PAT (this repo; Dependabot alerts: read, Administration: read, Metadata: read) and gh secret set WEEKLY_AUDIT_GH_TOKEN, then a workflow_dispatch of weekly-audit shows whether both rows turn from unavailable to values. Close when they do; fall back to (b) for any row that stays unavailable.
---
<!-- COMMENTS:END -->
