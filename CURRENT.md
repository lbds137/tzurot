# Current

> **Session**: 2026-03-09
> **Version**: v3.0.0-beta.89

---

## Session Goal

_Voice Engine v3.0.0-beta.89 release — merge, deploy, post-release cleanup._

## Active Task

Release complete. Follow-up items added to BACKLOG.md inbox.

---

## Completed This Session

- **release**: v3.0.0-beta.89 merged to main and deployed (102 commits, 193 files)
- **fix(voice-engine)**: Address 3 rounds of PR #714 review feedback + Python test coverage (~68% → ~80%)
- **fix(voice-engine)**: MIME validation on `/v1/voices/register`, commaIndex invariant comment
- **fix(ai-worker)**: Tighten `isConnectionError` to exact match, TTS timeout 60s → 90s
- **fix(bot-client)**: SSRF defense-in-depth for `modelUsed` in OpenRouter URL
- **docs**: Long-lived branch protection rules (near-miss: almost deleted `develop`)
- **docs**: Post-mortem added to CLAUDE.md for branch deletion near-miss
- **chore**: DB migration applied to prod (`voiceReferenceData` + `voiceReferenceType`)

## Post-Deploy Checklist

- [x] Merge PR #714 to main (local fast-forward, GitHub couldn't rebase 102 commits)
- [x] Create release tag + GitHub release notes
- [x] DB migration applied to prod
- [ ] Run `/admin db-sync` in Discord to sync voice references to prod
- [ ] Smoke test voice commands in production

## Recent Releases

- **v3.0.0-beta.89** (2026-03-09) — Voice Engine Phases 1–3b: Python STT/TTS service, ai-worker integration, voice commands, settings dashboards
- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping

## Follow-Up Items (in BACKLOG inbox)

- Log warning on `voiceReferenceType` WAV fallback
- Comment on `shouldRunTTS` default
- Expand `mypy --strict` to test files
- Clean up completed voice-engine proposal doc

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
