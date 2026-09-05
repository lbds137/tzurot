---
id: TASK-898
title: >-
  weekly-audit: Dependabot-alerts and repo-settings rows are structurally
  unavailable under GITHUB_TOKEN
status: To Do
assignee: []
created_date: '2026-09-05 13:02'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:owner'
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
