# Voice Engine Python Workflow on Steam Deck

The `services/voice-engine/` service runs Python (FastAPI + heavy ML deps).
Quality checks (ruff, mypy, pytest) run through `uv`, pinned to the same
Python version as prod and CI — no distrobox, no host `pip install`.

## Toolchain

| Piece        | Source                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `uv`         | mise (`~/Documents/dev-docs/mise/config.toml`)                                                                                    |
| Python 3.13  | `services/voice-engine/.python-version`, matching prod's `python:3.13-slim` and CI's `voice-engine-tests` job                     |
| Dependencies | `services/voice-engine/requirements-dev.txt`, installed by `uv` on demand into its own cache — never `pip install`d onto the host |

`uv run --no-project` reads `.python-version` and fetches (or reuses a
cached) matching interpreter, then installs `requirements-dev.txt` into an
ephemeral environment for the single invocation. `--no-project` keeps uv
from treating `services/voice-engine` as a project (creating and syncing a
`.venv` from `pyproject.toml`), so each run uses exactly the requirements
file CI installs.

## Running the checks

`.husky/pre-push` runs these automatically for any push touching Python
files. To run them by hand from the repo root:

```bash
cd services/voice-engine
uv run --no-project --with-requirements requirements-dev.txt -- ruff check .
uv run --no-project --with-requirements requirements-dev.txt -- mypy --strict server.py tests/
uv run --no-project --with-requirements requirements-dev.txt -- python3 -m pytest tests/ -q
```

## When you need the heavy ML deps

For integration testing against real models, the deps live in
`requirements.txt` (not `-dev`). The same pattern should work with
`uv run --no-project --with-requirements requirements.txt -- ...`, but it
has not been exercised on the Deck and would be slow and disk-hungry.

Most development can stay on the mocked test path: the heavy ML deps
(NeMo, PocketTTS, torch) are mocked in `conftest.py`.

## Related

- `services/voice-engine/CLAUDE.md` — the service's Python standards and conventions
- `~/Documents/dev-docs/STEAM_DECK_DEV_ENVIRONMENT.md` _(machine-local, not in repo)_ — full dev environment setup (containers, Node, etc.)
- [`SSH_SETUP.md`](./SSH_SETUP.md) — Git SSH setup for the same dev environment
