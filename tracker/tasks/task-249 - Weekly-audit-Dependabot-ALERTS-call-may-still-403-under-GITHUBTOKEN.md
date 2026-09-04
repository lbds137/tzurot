---
id: TASK-249
title: Weekly-audit Dependabot ALERTS call may still 403 under GITHUB_TOKEN
status: To Do
assignee: []
created_date: '2026-07-11 00:00'
updated_date: '2026-09-04 19:36'
labels:
  - 'area:ci'
  - 'origin:review'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 249000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Weekly-audit Dependabot ALERTS call may still 403 under GITHUB_TOKEN — PR #1583 gave the audit's security surface a GH_TOKEN + `security-events: read`; `gh pr list` is definitely covered, but the Dependabot alerts REST endpoint's permission model differs and GITHUB_TOKEN coverage is unverified. The stderr fix means a failure now degrades with a clear HTTP error naming the endpoint. **Fix shape**: fine-grained PAT (Dependabot alerts: read) stored as a secret, used only for the alerts call. **Promote when**: the next weekly-audit run (Saturday) still shows `security: unavailable` — with a 403 reason. Surfaced 2026-07-11 (PR #1583 review).

**Why:** Watch-item with a dated trigger; PR-body notes don't count as tracking.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:36
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. No fine-grained PAT added for the alerts call (the task's own fix shape); couldn't confirm or rule out via static grep whether a recent Saturday run actually 403'd (that requires reading a live CI run, out of scope for a read-only static pass) — treating as unresolved watch rather than guessing at the runtime outcome. Evidence: `grep -rn "security: unavailable\|Dependabot alerts" packages/tooling/src/audits/*.ts` → code present but no PAT-based secret reference found; did not fetch a live workflow run (heavy/out of scope).
---
<!-- COMMENTS:END -->
