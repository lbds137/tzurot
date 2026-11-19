---
id: TASK-1467
title: Align the tracker store path with backlog/ (Hub-canonical physical layout)
status: To Do
assignee: []
created_date: '2026-11-19T21:23:00Z'
labels:
  - area:repo
  - size:L
  - state:owner
dependencies: []
priority: low
ordinal: 1467000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the fleet standard (Lila AUQ 11-19, via Deck) pins backlog.md via SYG_TRACKING_SURFACE, and the seyag reference keeps the store at backlog/ with config.yml; the Hub may key on the physical path. Tzurot adopted the semantics (pin landed, BACKLOG.md manifest retired, claiming via assignee) but the store stays at tracker/ — recorded as deliberate in 06-backlog.md.

What: move planning files out of backlog/ (now.md, active-epic.md, cold/, cadence-ledger.json), git mv tracker/* to backlog/ (+ config.yml), update the tracker wiring, backlogLint/backlogDigest paths, tracker-commit BOARD_PATH_RE, pre-push, guards, hooks, rules and skills pointers, and tell Deck to re-index the Hub.

Promote when: the Hub requires the physical backlog/ path, or Tzurot adopts upstream backlog.md CLI features that assume the default store dir. Until then tracker/ is the store by recorded decision.

Owner question: should the tracker store physically move to backlog/ (seyag-canonical layout), or does the settings pin + recorded deviation satisfy the fleet standard?

Recommendation: keep tracker/ — the pin declares the surface, the format already matches, and the rename churns 1200+ files plus the tracker wiring for no semantic gain — unless the Hub proves path-sensitive.

Acceptance: store at backlog/ with config.yml; pnpm tracker, backlog:lint, backlog:digest, tracker:commit all green; Hub sees one store; zero BACKLOG.md references anywhere.
<!-- SECTION:DESCRIPTION:END -->
