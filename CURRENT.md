# Current

> **Session**: 2026-03-09
> **Version**: v3.0.0-beta.88 (v3.0.0-beta.89 in PR #714)

---

## Session Goal

_Voice Engine Phase 3b — Address PR #714 review feedback, improve Python test coverage, prepare release._

## Active Task

Finalizing PR review feedback + Python test coverage improvements for PR #714.

---

## Completed This Session

- **fix(bot-client)**: Add `encodeURIComponent` to `modelUsed` in OpenRouter URL (SSRF defense-in-depth)
- **fix(ai-worker)**: Tighten `isConnectionError` — exact match on `'fetch failed'` instead of `.includes()` to prevent false positives
- **refactor(ai-worker)**: Move `voiceTranscriptCache` from dynamic import to top-level static import in AudioProcessor
- **docs(ai-worker)**: Add clarifying comments for JSON casts in VoiceEngineClient (internal service contract)
- **docs(ai-worker)**: Add invariant comment on `splitTextIntoChunks` return guarantee in ttsSynthesizer
- **docs(ai-worker)**: Add comment explaining mid-word break fallback in `forceSplitLongSentence`
- **docs(voice-engine)**: Document cold-start timing budget limitation in deployment gotchas
- **test(ai-worker)**: Add tests for exact `'fetch failed'` match and substring non-match in VoiceRegistrationService
- **test(voice-engine)**: Add Python tests for OpenAI-compat endpoints, TTS reference audio, voice registration errors

## Completed Last Session (2026-03-08)

- **feat(voice-engine)**: Phase 3b voice commands + cascade wiring merged (PR #710)
- Deployed to Railway development: fixed GATEWAY_URL, HF_TOKEN, volume permissions, first-run timeout
- Verified end-to-end TTS flow working in production
- Health check retry loop for Railway Serverless cold starts (5 attempts × 3s)
- Negative cache bypass for transient connection errors (ECONNREFUSED cause chain traversal)
- PR #714 created for v3.0.0-beta.89 release

## Recent Releases

- **v3.0.0-beta.88** (2026-03-04) — Custom ID fix, tar security patch, interaction error resilience, XML wrapper stripping
- **v3.0.0-beta.87** (2026-03-04) — showModelFooter config cascade, XML tool-use wrapper stripping
- **v3.0.0-beta.86** (2026-03-03) — LLM response quality fixes

## Next Steps

1. Run tests + quality checks (sequential on Steam Deck)
2. Push changes, wait for CI green
3. Merge PR #714 to `main` (rebase, delete branch)
4. Deploy to production (Railway auto-deploys from `main`)
5. Run `pnpm ops db:migrate --env prod` if migration included
6. Re-upload voice references in production (voice references don't sync via `/admin db-sync`)

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
