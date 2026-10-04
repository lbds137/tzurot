---
id: TASK-1084
title: >-
  docs/steam-deck/SSH_SETUP.md contradicts the Deck setup: it starts a second
  ssh-agent
status: To Do
assignee: []
created_date: '2026-09-24 18:14'
updated_date: '2026-10-04 23:08'
labels:
  - 'area:docs'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1077000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: flagged 2026-09-24 by the Deck-management Claude session (peer, not the owner). docs/steam-deck/SSH_SETUP.md tells the reader to paste a pgrep ssh-agent || eval "$(ssh-agent -s)" block into ~/.bashrc (lines 19-24, 45). Since 2026-09-23 ~/.bashrc is a stub loading ~/Documents/dev-docs/shell/, SSH runs on one systemd ssh-agent.socket (SSH_AUTH_SOCK set in shell/env.sh, AddKeysToAgent yes in ~/.ssh/config, checked by deck-doctor), so following the doc starts a second agent beside the socket. The machine setup now lives in dev-docs (STEAM_DECK_DEV_ENVIRONMENT.md, machine-local), so what is left in this file is generic add-your-key-to-GitHub text. Inbound links: docs/README.md and the Related list at the bottom of docs/steam-deck/VOICE_ENGINE_PYTHON.md (which is accurate and stays).
Acceptance: the file is gone (or cut per the ruling), no inbound link to it remains (grep SSH_SETUP), and the doc-audit skill mention of docs/steam-deck still reads true.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Owner decision 2026-10-04 (AskUserQuestion, chose the recommendation): delete docs/steam-deck/SSH_SETUP.md and both inbound links.
<!-- SECTION:NOTES:END -->
