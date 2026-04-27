# Current

> **Session**: 2026-04-26 → 2026-04-27 (extended marathon — DM-silence epic + Identity Hardening close-out + beta.108 release)
> **Version**: v3.0.0-beta.108 (released 2026-04-27)

---

## Next Session Goal

_No production issues active. beta.108 just shipped with the post-deploy DM-silence fix end-to-end resolved + Identity Hardening Epic CLOSED. Pick from the candidates below._

1. **z.ai provider integration** — User has a $18/month z.ai coding plan they want to actually use with Tzurot. Multi-user scope, route-on-key (same model can have z.ai key OR fall through to OpenRouter), auto-fallthrough behavior. Wrinkle: z.ai has separate pay-as-you-go vs. coding-plan endpoints — need to research docs to differentiate. Architectural shape: provider-routing-as-property-of-API-key, not preset/user toggle. See preview discussion in 2026-04-26/27 session log.
2. **TTS Engine Upgrade (Active Epic)** — Chatterbox Turbo is the primary candidate. Next concrete step: spin up Chatterbox in a test container (Railway dev or local), feed it a character reference audio, compare quality vs. Pocket TTS and ElevenLabs. Cost-bleed-driven (~$200/mo ElevenLabs).
3. **Quick Wins remaining (post-bundle)** — once the bundle PR ships, what's left: delete `DM_RAW_GATEWAY_DIAGNOSTIC` env entry from Railway dashboard (dashboard cleanup, no code), and "make duplicate-exports + knip blocking in CI" (needs allowlist triage first — 30-60min focused task, its own PR).

## Active Task

**Post-beta.108 cleanup bundle PR** (in progress) — three small items folded into one PR:

1. TTS chunker defensive truncation (real bug, Lilith observation 2026-04-27 — chunker produced 2006 chars against 2000-char voice-engine cap; root cause unreproducible from user-pasted text but truncation cuts the failure path regardless)
2. Await async cleanup before `process.exit` in bot-client shutdown (PR #913 follow-up — `void`'d promises don't resolve before exit)
3. Replace local `CreatePersonaResponse` with imported common-types type (drift prevention — local interface and Zod schema can silently diverge)

Branch: `chore/post-beta-108-cleanup`. Fix shapes documented in `backlog/quick-wins.md`.

---

## Unreleased on Develop (since beta.108)

_Nothing yet — beta.108 was just cut._

---

## Previous Sessions

- **2026-04-26 → 2026-04-27**: 11 PRs merged (#908, #909, #910, #911, #912, #913, #914, #915, #916, #917, #918) + Identity Hardening Epic CLOSED + post-deploy DM-silence resolved end-to-end across six PRs of progressive diagnosis + new `09-interaction-style.md` rule + beta.108 cut (PR #919).
- **2026-04-25** (continuation of marathon): beta.105 production failures observed within minutes of deploy; audit + council consultation surfaced 3 critical hardening items; PR #893 shipped beta.106 hotfix after **8 review rounds** and a real security bug catch (Teredo RFC 5952 canonical-form gap, found by claude-bot).
- **2026-04-24**: 7 PRs merged + new review-response rule + CI `fixup-check` job + workflow rule amendments + beta.105 cut (PR #892).
- **2026-04-23**: Identity Epic Phase 6 + ApiCheck autocomplete cache + Inbox triage.
- **2026-04-22 → 2026-04-23**: v3.0.0-beta.104 released. Phase 5c PR C cutover + tech-debt sweep PR #866.
- **2026-04-21**: Tech-debt sweep PR #866.
- **2026-04-20**: v3.0.0-beta.102 released — Kimi K2.5 routing fix, hybrid post-action UX, CITEXT name uniqueness.
- **2026-04-19 / 2026-04-20**: v3.0.0-beta.101 released — Preset clone fix, ReDoS, TTS Opus transcode default, PR-monitor hook, Phase 5c PR A/B.
- **2026-04-17**: Phase 5b shipped + beta.99 release — PR #818, PR #819.
- **2026-04-15 / 2026-04-16**: Identity epic phases 3/4/5 + beta.98.
- **2026-04-14**: Identity epic Phase 1 + beta.97.

## Recent Releases

- **v3.0.0-beta.108** (2026-04-27) — **Post-deploy DM-silence resolved end-to-end** across six PRs of progressive diagnosis (SIGTERM handler #913, Partials.Message + User #914, diagnostic listeners #915, DM cache warmer #916, startup pre-warm Layer 1 #917, retry-with-backoff for startup race #918). **Identity & Provisioning Hardening Epic CLOSED** (#911) — `requireProvisionedUser` middleware tightened to strict 400/403/500, `getOrCreateUserShell` deleted, -1404 lines net. **IPv6 mixed-compression hardening** in SSRF guard (#908). Repo improvements: vestigial `setAsDefault` removed (#912), test-utils consolidation (#909), MOCK_USER_ID UUID normalization (#910), `09-interaction-style.md` rule promotion (#915).
- **v3.0.0-beta.107** (2026-04-26) — Inspect UX hardening mini-epic completed: stateful filter / sort / Top-N buttons on Memory Inspector (#901), Pipeline Health checklist + quick-copy summary (#899), owner-only redaction of character internals (#898), embed redesign for the post-#895 diagnostic shape (#897). **Preset autocomplete fail-open fix** (#906) — wallet-API failures no longer hide paid models from users with active keys. SSRF defense-in-depth: `discordCdnGuard` helper now applied at every attachment fetch site including the JSON-download utility (#905); IPv6 loopback Set covers uncompressed form. Internal: OpenRouter reasoning extraction switched from transport-layer body mutation to `__includeRawResponse` post-parse (#895), three-layer canary safety net (#896). BACKLOG.md restructured into per-section files under `backlog/` (#904). Pre-push hook now clears depcruise cache (#902).
- **v3.0.0-beta.106** (2026-04-25) — Hotfix for beta.105 production failures: external embed images (Reddit/Imgur/Tenor) now reach the LLM via new `safeExternalFetch` module with layered SSRF defenses (DNS-resolution + IP-range guards including IPv4-mapped/6to4/Teredo recursion, browser User-Agent, Content-Type assertion); single bad URL no longer aborts whole conversation (partial-success tolerance in DownloadAttachmentsStep); bot error replies now include actual failure detail in spoiler tag instead of generic "Sorry, I encountered an error" (errorInfo populated in pipeline catch); VisionProcessor SSRF theater dropped (LLM provider does the fetch). Council-reviewed (Gemini 3.1 Pro Preview). 8 review rounds with 1 real security bug caught by claude-bot (Teredo RFC 5952 canonical-form gap).
- **v3.0.0-beta.105** (2026-04-24) — Attachment download lifted from api-gateway to ai-worker (#889); downloadAll hardening + 50 MiB aggregate cap (#890); transcription queue-age gate (#891); GLM-4.7 meta-preamble fix (#888); two-tier autocomplete cache (#884); identity Phase 6 part 2 + ESLint rule (#881, #882); pglite CHECK constraints (#887); typing-indicator classifier (#886); autocomplete sentinel guards (#885); uuid CVE pin.
- **v3.0.0-beta.104** (2026-04-23) — shapes.inc cookie migrated Auth0 → Better Auth; GLM-4.5-air thought leak via Chain-of-Extractors pattern; new release tooling; bot-client submit-job timeout bump.
- **v3.0.0-beta.103** (2026-04-22) — Identity Epic Phase 5c PR C cutover; voice multi-chunk TTS Opus fix; `ApiCheck<T>` tri-state type; tech-debt paydown.
- **v3.0.0-beta.102** (2026-04-20) — Hybrid post-action UX, Kimi K2.5 routing fix, CITEXT name uniqueness.
- **v3.0.0-beta.101** (2026-04-20) — Preset clone PK fix, TTS Opus transcode default, Phase 5c PR A/B.
- **v3.0.0-beta.100** (2026-04-17) — `/admin db-sync` refactor, character truncation warning, protobufjs CVE.

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
