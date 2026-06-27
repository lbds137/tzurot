## Theme Queue

_Ordered index of future themes. Grep-on-demand — not loaded at session start. Each links to its file in `themes/`._

> **Next theme: OPEN — the Test-Pyramid Taxonomy + Coverage Audit epic COMPLETED 2026-06-26 (Phases 1–4, PR1–7), so the Active Epic slot is now empty; pick the next theme** from the list below by dependency + value. Each substantial pick deserves its own council pass before plan-mode. The previous "Next Theme: CPD Clone Reduction" was completed differently by the 2026-05-16 campaign (reframed to filtered-metric + CI ratchet + documented boundary; close-out audit in [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](../../docs/reference/CPD_CAMPAIGN_AUDIT.md)); its remaining work is the "Adjacent CPD Follow-Up Campaigns" theme below.

- [Periodic Audit Enforcement Architecture](themes/periodic-audit-enforcement-architecture.md) — make the ~9 "run periodically" audit tools actually run without rotting _(partial — reconciled 2026-06-26: Layer 1 canary shipped; Layers 2–5 + the ops:health aggregator remain)_
- [User-feedback solicitation + revive v2 release-notes delivery](themes/user-feedback-solicitation-revive-v2-release-notes-delivery.md) — structured channel for non-direct-contact user feedback + release-notes DM blast
- [Shapes.inc Fetcher Hardening (multi-item mini-epic)](themes/shapes-inc-fetcher-hardening.md) — harden shapes.inc fetch against API drift, bot-protection, graceful failure
- [Security Audit Pass (discovery mini-epic)](themes/security-audit-pass.md) — systematic review of hostile-user attack surface; output is per-finding backlog items
- [Preset Cascade Standardization (multi-PR epic)](themes/preset-cascade-standardization.md) — character-tier preset editing + cross-tier cascade UX parity
- [Enforce "Human Users Only" at Auth Middleware](themes/enforce-human-users-only-at-auth-middleware.md) — middleware-level invariant rejecting bot-user HTTP requests _(partial — reconciled 2026-06-26: bot rejection lives in requireProvisionedUser; the requireUserAuth-level invariant remains — small)_
- [Railway Log Search DX for Incident Digs](themes/railway-log-search-dx-for-incident-digs.md) — cross-service log correlation via request-id threading + Railway query DSL _(partial — reconciled 2026-06-26: requestId threading + filter docs shipped; only ergonomic ops flags remain — small)_
- [Memory System Overhaul](themes/memory-system-overhaul.md) — LTM summarization → table migration → OpenMemory waypoint graph
- [Character Portability](themes/character-portability.md) — import/export characters and user data; users own their data _(partial — reconciled 2026-06-26: /character export + shapes-import shipped; PNG card import + sidecar prompts remain)_
- [User-Requested Features](themes/user-requested-features.md) — multi-personality channels, sidecar prompts, allowlists, emoji actions
- [Provider Prompt Caching (cost-reduction epic)](themes/provider-prompt-caching.md) — stabilize prompt prefix for provider-side caching to cut multi-turn cost
- [Model Configuration Overhaul](themes/model-configuration-overhaul.md) — first-class vision config + LLM config profiles bundling paid/free/vision
- [Next-Gen AI Capabilities](themes/next-gen-ai-capabilities.md) — agentic scaffolding, advanced prompt features, image generation
- [Voice Engine](themes/voice-engine.md) — two-tier STT/TTS _(partial — reconciled 2026-06-26: phases 1–4.6 + pipeline resilience shipped; shapes voice import + parallel TTS chunking remain)_
- [Typing Indicator Reliability](themes/typing-indicator-reliability.md) — diagnose and fix intermittent typing-indicator dropouts during long responses _(partial — reconciled 2026-06-26: the typing-send helper shipped; the investigation + 2 sub-items remain)_
- [Observability & Telemetry](themes/observability-and-telemetry.md) — structured-log telemetry, user analytics, error-serialization audits
- [`/voice` + `/inspect` UX Polish (mini-epic)](themes/voice-inspect-ux-polish.md) — fix UX rough edges on `/voice` and `/inspect` surfaces
- [Self-Hosted TTS + BYOK Re-Evaluation](themes/self-hosted-tts-byok-re-evaluation.md) — re-evaluate TTS engines after NeuTTS Air abandoned; BYOK quality-shopping
- [Adjacent CPD Follow-Up Campaigns](themes/adjacent-cpd-follow-up-campaigns.md) — four deferred DRY-extraction campaigns from the 2026-05-16 close-out
- **Slim common-types (PR-2n)** → ✅ COMPLETE (extraction arc + close-out sweep done 2026-06-23; historical log in [epic-log.md](epic-log.md))
- **Test-Pyramid Taxonomy + Coverage Audit** → ✅ COMPLETE (Phases 1–4, PR1–7 shipped 2026-06-26; close-out council parked the flow-level gate + filed the post-deploy smoke check — see `follow-ups.md` / `ideas.md`). Detailed theme writeup retained at [themes/test-pyramid-coverage-audit.md](themes/test-pyramid-coverage-audit.md); slice log in [epic-log.md](epic-log.md)
- [Multimodal Input — file (PDF/doc) + video forwarding](themes/multimodal-input-file-video-forwarding.md) — capture/forward video + file modalities to capable models, surface in `/models`
- [Type-Assertion Audit + Deterministic Ratchet](themes/type-assertion-audit-deterministic-ratchet.md) — triage untyped casts + deterministic gate against new unsafe assertions
- [Deterministic Test-Quality Tooling](themes/deterministic-test-quality-tooling.md) — mutation testing + job-payload contract so seam bugs fail the build
- [Production Observability — perf metrics + distributed tracing](themes/production-observability-perf-metrics-tracing.md) — time-series metrics + tracing for load-correlated prod issues
- [Export/Import/Template/Clone Field Completeness](themes/export-import-template-clone-field-completeness.md) — derive serialize field sets from Zod schema, not hard-coded lists
