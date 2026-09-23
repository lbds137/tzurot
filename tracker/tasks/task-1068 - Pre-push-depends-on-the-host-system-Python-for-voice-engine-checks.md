---
id: TASK-1068
title: Pre-push depends on the host system Python for voice-engine checks
status: To Do
assignee: []
created_date: '2026-09-23 23:58'
labels:
  - 'area:voice'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 1062000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: .husky/pre-push runs ruff/mypy/pytest for services/voice-engine with the SteamOS host Python (3.13.5 at 2026-09-23) and packages under ~/.local/lib/python3.13, which were pip-installed from inside the distrobox via the shared $HOME. A SteamOS Python bump silently breaks pre-push. docs/steam-deck/VOICE_ENGINE_PYTHON.md still says host Python is for reading code only and pytest runs in the distrobox. Found by a sibling env-cleanup session.
Fix shape: once the env cleanup Phase 2 lands mise-managed Python + uv, switch the pre-push voice-engine steps to `uv run` against a pinned Python and update VOICE_ENGINE_PYTHON.md.
Acceptance: pre-push voice-engine checks run from a pinned toolchain, independent of the system Python.
Depends on: env cleanup Phase 2 (mise Python + uv on the Deck).
<!-- SECTION:DESCRIPTION:END -->
