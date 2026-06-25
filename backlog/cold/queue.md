## Theme Queue

_Ordered index of future themes. Grep-on-demand — not loaded at session start. Each links to its file in `themes/`._

> **Next theme: OPEN** — pick the next one when the Active Epic (`../active-epic.md`, Test-Pyramid Taxonomy + Coverage Audit) completes. Choose by dependency + value; each substantial pick deserves its own council pass before plan-mode. The previous "Next Theme: CPD Clone Reduction" was completed differently by the 2026-05-16 campaign (reframed to filtered-metric + CI ratchet + documented boundary; close-out audit in [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](../../docs/reference/CPD_CAMPAIGN_AUDIT.md)); its remaining work is the "Adjacent CPD Follow-Up Campaigns" theme below.

- [Periodic Audit Enforcement Architecture](themes/periodic-audit-enforcement-architecture.md) — make the ~9 "run periodically" audit tools actually run without rotting
- [User-feedback solicitation + revive v2 release-notes delivery](themes/user-feedback-solicitation-revive-v2-release-notes-delivery.md) — structured channel for non-direct-contact user feedback + release-notes DM blast
- [Shapes.inc Fetcher Hardening (multi-item mini-epic)](themes/shapes-inc-fetcher-hardening.md) — harden shapes.inc fetch against API drift, bot-protection, graceful failure
- [Security Audit Pass (discovery mini-epic)](themes/security-audit-pass.md) — systematic review of hostile-user attack surface; output is per-finding backlog items
- [Preset Cascade Standardization (multi-PR epic)](themes/preset-cascade-standardization.md) — character-tier preset editing + cross-tier cascade UX parity
- [`/character chat` — push-based result delivery + DM support](themes/character-chat-push-delivery.md) — push-based delivery fixes orphaned free-model jobs + DM support
- [Schema Audit for Nullable-That-Isn't FK Columns](themes/schema-audit-nullable-fk-columns.md) — find schema concessions where null isn't a real application state
- [Enforce "Human Users Only" at Auth Middleware](themes/enforce-human-users-only-at-auth-middleware.md) — middleware-level invariant rejecting bot-user HTTP requests
- [Railway Log Search DX for Incident Digs](themes/railway-log-search-dx-for-incident-digs.md) — cross-service log correlation via request-id threading + Railway query DSL
- [Package Extraction](themes/package-extraction.md) — reduce common-types export bloat, split the oversized bot-client package
- [Memory System Overhaul](themes/memory-system-overhaul.md) — LTM summarization → table migration → OpenMemory waypoint graph
- [Character Portability](themes/character-portability.md) — import/export characters and user data; users own their data
- [User-Requested Features](themes/user-requested-features.md) — multi-personality channels, sidecar prompts, allowlists, emoji actions
- [Provider Prompt Caching (cost-reduction epic)](themes/provider-prompt-caching.md) — stabilize prompt prefix for provider-side caching to cut multi-turn cost
- [Model Configuration Overhaul](themes/model-configuration-overhaul.md) — first-class vision config + LLM config profiles bundling paid/free/vision
- [Next-Gen AI Capabilities](themes/next-gen-ai-capabilities.md) — agentic scaffolding, advanced prompt features, image generation
- [Voice Engine](themes/voice-engine.md) — two-tier STT/TTS; remaining shapes voice import + pipeline resilience
- [Typing Indicator Reliability](themes/typing-indicator-reliability.md) — diagnose and fix intermittent typing-indicator dropouts during long responses
- [Observability & Telemetry](themes/observability-and-telemetry.md) — structured-log telemetry, user analytics, error-serialization audits
- [Tooling & Quality Ratchet](themes/tooling-and-quality-ratchet.md) — CI strictness ratchets, schema-type unification, test infrastructure
- [`/voice` + `/inspect` UX Polish (mini-epic)](themes/voice-inspect-ux-polish.md) — fix UX rough edges on `/voice` and `/inspect` surfaces
- [Self-Hosted TTS + BYOK Re-Evaluation](themes/self-hosted-tts-byok-re-evaluation.md) — re-evaluate TTS engines after NeuTTS Air abandoned; BYOK quality-shopping
- [Adjacent CPD Follow-Up Campaigns](themes/adjacent-cpd-follow-up-campaigns.md) — four deferred DRY-extraction campaigns from the 2026-05-16 close-out
- **Slim common-types (PR-2n)** → ✅ COMPLETE (extraction arc + close-out sweep done 2026-06-23; historical log in [epic-log.md](epic-log.md))
- **Test-Pyramid Taxonomy + Coverage Audit** → now the Active Epic; see [../active-epic.md](../active-epic.md) (detailed theme writeup retained at [themes/test-pyramid-coverage-audit.md](themes/test-pyramid-coverage-audit.md))
- [Multimodal Input — file (PDF/doc) + video forwarding](themes/multimodal-input-file-video-forwarding.md) — capture/forward video + file modalities to capable models, surface in `/models`
- [Type-Assertion Audit + Deterministic Ratchet](themes/type-assertion-audit-deterministic-ratchet.md) — triage untyped casts + deterministic gate against new unsafe assertions
- [Deterministic Test-Quality Tooling](themes/deterministic-test-quality-tooling.md) — mutation testing + job-payload contract so seam bugs fail the build
- [Production Observability — perf metrics + distributed tracing](themes/production-observability-perf-metrics-tracing.md) — time-series metrics + tracing for load-correlated prod issues
- [Export/Import/Template/Clone Field Completeness](themes/export-import-template-clone-field-completeness.md) — derive serialize field sets from Zod schema, not hard-coded lists
