---
id: TASK-1068
title: Pre-push depends on the host system Python for voice-engine checks
status: Done
assignee: []
created_date: '2026-09-23 23:58'
updated_date: '2026-09-24 04:42'
labels:
  - 'area:voice'
  - 'size:S'
  - 'state:ready'
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
Box constraint (2026-09-23): the old `tzurot-dev` distrobox (Fedora 41) is kept, stopped, only because its pip is the one way to install into the host's ~/.local/lib/python3.13 (`distrobox enter tzurot-dev -- pip install --user X`). The new `tools` box (Fedora 44, Python 3.14, no pip) must NOT back voice-engine. The old box is deleted only after this task moves pre-push to uv.
Agreed split with the env-cleanup session (2026-09-23): that session adds `uv` via mise machine-wide WITHOUT a mise python3 on PATH (the step changes nothing pre-push or the hooks resolve); this task then pins services/voice-engine to Python 3.11, matching prod (`services/voice-engine/Dockerfile` FROM python:3.11-slim), CI (`.github/workflows/ci.yml` python-version '3.11') and pyproject `requires-python = ">=3.11"`, not the host 3.13. It installs the same set CI installs (requirements*.txt; pyproject declares no dependency list), switches the pre-push ruff/mypy/pytest steps to `uv run`, and updates VOICE_ENGINE_PYTHON.md. Only after pre-push is green does that session retire the ~/.local pip packages and the old box. Other host-Python users checked: the `.claude/hooks/*.sh` Python heredocs call bare `python3` but import only stdlib plus `.claude/hooks/lib/shell_quotes.py`, so they survive the retirement as long as a python3 stays on PATH; nothing in package.json, packages/tooling or scripts/ shells out to Python. Flip to state:ready once `uv --version` works on the host.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-24 00:59
---
Dependency met 2026-09-23 (env-cleanup session, verified from login and non-login shells): uv 0.12.18 via mise shims; uv-downloaded CPython 3.11.16 in ~/.local/share/uv; no mise python shims; python3 still /usr/bin/python3 3.13.5 and ruff/mypy/pytest still resolve as before, so pre-push is unchanged until this task lands. Pin via services/voice-engine/.python-version = 3.11 (what uv reads). After pre-push is green on uv, tell the env-cleanup session so it can do step 3.
---
created: 2026-09-24 01:00
---
DONE 2026-09-24: PR #2498 (ad6c3bc68). services/voice-engine/.python-version pins 3.11, and CI's setup-python reads it via python-version-file. Pre-push step 12 and lint-staged's *.py tasks run through `uv run --no-project --with-requirements requirements-dev.txt` (lint-staged adds `--directory services/voice-engine`). knip ignoreBinaries swaps ruff for uv, and VOICE_ENGINE_PYTHON.md describes the uv workflow.

Acceptance met, verified with ~/.local/bin removed from PATH:
- ruff, mypy and pytest (81) pass;
- `python3` inside uv is the uv 3.11.16 env, and fastapi is imported from uv's cache;
- lint-staged red (old config: `Task failed to spawn: ruff`) then green (new config) on a staged probe.

The lint-staged gap was found by the machine-setup session. Ping (b) was sent to that session, which can now retire the ~/.local python3.13 packages and the tzurot-dev box. The move to 3.13 is TASK-1070 (after the beta.229 cut).
---
<!-- COMMENTS:END -->
