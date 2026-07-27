---
id: TASK-264
title: 'Deployment skill: railway redeploy acts on the LINKED environment'
status: To Do
assignee: []
created_date: '2026-07-13 00:00'
labels:
  - 'area:voice'
dependencies: []
ordinal: 264000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Deployment skill: `railway redeploy` acts on the LINKED environment — `railway redeploy` has no `--environment` flag — it targets whatever env the CLI is linked to (`railway status` shows it). A blind `redeploy -s voice-engine -y` nearly bounced PROD when the link happened to be production; the safe sequence is status-check → `railway environment <env>` → redeploy → restore link. **Fix shape**: one gotcha line + the safe sequence in `/tzurot-deployment` § Service Restart (skills are review-gated → ride the next skills PR). **Promote when**: next skills-touching PR. Surfaced 2026-07-13 (voice-engine boot probe).

**Why:** The near-miss class: env-implicit CLI commands against shared infra.
<!-- SECTION:DESCRIPTION:END -->
