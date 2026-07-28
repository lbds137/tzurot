---
id: TASK-104
title: Trim 7 over-cap voice references
status: To Do
assignee: []
created_date: '2026-05-13 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: low
ordinal: 104000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Trim 7 over-cap voice references

**Why:** Blocked on owner re-uploading trimmed clips for 8 personalities (refs >30s silently fall through Mistral cloning to self-hosted): `rich-fairbank-meshavesh-astrategi` (235.63s outlier), `verosika-hi-sukubusit` (43.15s), `baphomet-ani-miqdash-tame` (39.94s), `machbiel-ani-mistori` (33.62s), `shekhinah-hi-akhat-kan` (33.38s), `ha-shem-keev-ima` (31.78s), `sir-pentious-malakh-nachash` (30.35s), plus `lilith-tzel-shani` (29.99s — at the cap). No code work — audit tool shipped 2026-05-13. **Re-run** `pnpm ops voice-refs:audit --env prod` after each trim batch. Deferred 2026-05-19 (inbox sweep).
<!-- SECTION:DESCRIPTION:END -->
