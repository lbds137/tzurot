# Current

> **Session**: 2026-04-12
> **Version**: v3.0.0-beta.95

---

## Session Goal

_Voice engine cold start hardening, ElevenLabs abort fix, release process audit, and release v3.0.0-beta.95._

## Active Task

**None — session complete.** PR #785 merged + release v3.0.0-beta.95 shipped. Voice engine startup reduced from ~70s to ~25s. Python developer tooling parity achieved (pre-commit + pre-push hooks). Release notes process fixed after audit found beta.94 had duplicate entries from beta.93.

---

## Completed This Session

### PR #785 — Voice Engine Cold Start Hardening + ElevenLabs Abort Fix

**Three independent fixes:**

1. **Python voice-engine**: Removed all voice pre-loading from startup. Voices now lazy-load from `voices/` directory on first TTS request with per-voice `asyncio.Lock` (thundering herd prevention) and double-check pattern. Atomic file writes in `/register` via `tempfile.mkstemp` + `os.rename`. Startup drops from ~70s to ~25s (model loading only).

2. **TypeScript warmup**: Increased health-poll budget from 75s to 120s — ample headroom with the faster startup.

3. **ElevenLabs abort fix**: Added `readBody()` helper wrapping `response.arrayBuffer()` / `response.json()` with AbortError → ElevenLabsTimeoutError conversion. All 5 endpoints covered with explicit tests. Prevents raw "aborted" message surfacing to users.

9 rounds of AI review feedback addressed. Council MCP consulted for architecture validation (Gemini 3.1 Pro Preview).

### Python Developer Tooling Parity

- **Pre-commit** (lint-staged): `ruff check --fix` + `ruff format` for staged `.py` files
- **Pre-push**: `ruff check` + `mypy --strict` when Python files are in the push

Both were prompted by CI failures that should have been caught locally — ruff import sorting and mypy `no-any-return`.

### Release Process Audit + Fix

Audited last 5 releases (beta.90–94). Found beta.94 had 4 duplicate items from beta.93 (PR #759, #760, ConfigStep fix, bogus PR #764/#767 references). Root cause: CURRENT.md tracked "since beta.92" and was never reset after beta.93 shipped.

**Fixes applied:**

- Corrected beta.94 release notes on GitHub
- Updated git-workflow skill: release notes must use `git log v<previous-tag>..HEAD` as source of truth
- Added post-release CURRENT.md reset step to release procedure
- Added `release:verify-notes` tooling command to backlog (Icebox)

### Other

- **langsmith >=0.5.18** security override (prototype pollution CVE, Dependabot #83)
- **Release v3.0.0-beta.95** — 47 commits, PR #786

---

## Unreleased on Develop (since beta.95)

_(Empty — just released)_

---

## Previous Sessions

- **2026-04-12**: Voice engine hardening (PR #785), Python hooks, release audit, beta.95
- **2026-04-11**: CPD Session 1 (PRs #778-780), channel rename (#781), doc audit (#782-784)
- **2026-04-10**: Browse Step 8 (PR #776), CPD 137→126
- **2026-04-09**: Browse Steps 6-7 (PR #775), footer design plan + council consultation
- **2026-04-06**: Architecture day (PRs #766, #768, #769), CPD 146→137

## Recent Releases

- **v3.0.0-beta.95** (2026-04-12) — Voice engine lazy loading, ElevenLabs abort fix, CPD Session 1, browse epic, doc audit
- **v3.0.0-beta.94** (2026-04-10) — Browse standardization, config override helpers, shared abstractions
- **v3.0.0-beta.93** (2026-04-05) — Voice engine retry, security bumps, cascade resolver fixes

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
