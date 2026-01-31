# Current

> **Session**: 2026-01-31
> **Version**: v3.0.0-beta.60

---

## Session Goal

_Pull next item from BACKLOG High Priority._

---

## Active Task

_(No active task - pull from BACKLOG)_

---

## Session Summary (2026-01-31)

Major cleanup session:

- **v2 Legacy Cleanup**: Removed scripts/ and tests/ from tzurot-legacy (Jest-based, not useful for v3). Kept src/ for feature porting reference and useful docs (Shapes API, features).
- **v3 Scripts Cleanup**: Removed v2 cruft from v3 scripts/ (git helpers, Jest-based testing scripts). Added Steam Deck SSH docs.
- **Baseline Consolidation**: Moved baselines to `.github/baselines/`, deleted stale contract/service baseline files (superseded by unified audit).
- **Safety Improvements**: Added explicit `rm -rf` prohibition to CLAUDE.md after data loss incident.
- **Git Workflow**: Documented sync-develop process in tzurot-git-workflow skill.

---

## Recent Highlights

- **beta.60**: DM personality chat support, sticky DM sessions, speaker identification fix, model indicator storage bug fix
- **beta.58**: ConversationSyncService standardization, testing infrastructure
- **beta.57**: DeepSeek R1 reasoning fix, temperature jitter, LLM config key consolidation
- **beta.56**: Reasoning param conflict warning, API-level reasoning extraction tests
- **beta.55**: ownerId NOT NULL migration, stop sequences fix, model footer on errors

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items (replaces ROADMAP + TECH_DEBT)
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
