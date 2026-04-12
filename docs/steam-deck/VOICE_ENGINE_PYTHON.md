# Voice Engine Python Workflow on Steam Deck

The `services/voice-engine/` service runs Python (FastAPI + heavy ML deps), but SteamOS is an immutable filesystem with no `pip`. Python work has to happen inside the `tzurot-dev` distrobox container, not on the host.

## Why distrobox

| Environment  | Has `python3`? | Has `pip`? | Use for                   |
| ------------ | -------------- | ---------- | ------------------------- |
| SteamOS host | Yes (3.11+)    | **No**     | Reading code only         |
| `tzurot-dev` | Yes (3.13)     | Yes        | Running tests, installing |

The host's Python is unusable for development because the immutable filesystem blocks `pip install`. The `tzurot-dev` Fedora 41 distrobox has Python 3.13 + pip and is the only place voice-engine work can happen.

## Running Python tests

Wrap any Python command in `distrobox enter` (adjust the path to match where you've checked out the repo):

```bash
# Replace /home/deck/Projects/tzurot with your checkout path
distrobox enter tzurot-dev -- bash -c "cd /home/deck/Projects/tzurot && python3 -m pytest services/voice-engine/tests/"
```

The `bash -c` wrapper is necessary because `distrobox enter -- <cmd>` doesn't preserve the working directory by default — `cd` first inside the wrapped shell.

## Installing dev dependencies

Inside the container (again, adjust the `cd` path for your checkout):

```bash
distrobox enter tzurot-dev
cd /home/deck/Projects/tzurot
pip install -r services/voice-engine/requirements-dev.txt
```

`requirements-dev.txt` includes the FastAPI test client, numpy, and scipy. Heavy ML deps (NeMo, PocketTTS, torch) are **not** in requirements-dev — they're mocked in `conftest.py` so the test suite runs without GPU/CUDA tooling.

## When you need the heavy ML deps

For integration testing against real models, the deps live in `requirements.txt` (not `-dev`). Installing them on the Steam Deck distrobox is possible but slow and disk-hungry. Most development can stay on the mocked test path.

## Related

- `services/voice-engine/README.md` — service overview and architecture
- `~/Documents/dev-docs/STEAM_DECK_DEV_ENVIRONMENT.md` — full dev environment setup (containers, Node, etc.)
- [`SSH_SETUP.md`](./SSH_SETUP.md) — Git SSH setup for the same dev environment
