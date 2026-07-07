## Theme Queue

_Ordered index of future themes. Grep-on-demand — not loaded at session start. Each links to its file in `themes/`._

> **Active Epic: Memory System Overhaul** (promoted 2026-07-06 — the Spinoff-Theme Knockout completed; its trigger-gated stragglers PGLite-fidelity + z.ai-402 remain queued below). Pick future themes from this list by dependency + value; each substantial pick deserves a council pass before plan-mode.

- [Database Performance Audit](themes/database-performance-audit.md) — systematically find/prevent index + query perf debt before scale exposes it. _Triggered 2026-06-30 by the message_metadata GIN insert-stall that timed out a user-message persist (#1410/#1411). Prevention rule (Phase 1) is the cheap high-leverage start; the 2026-06-30 prod snapshot showed idx_scan=0 needs per-index judgment (no-query vs small-table-not-yet vs PK-constraint), not a mechanical drop._
- [Platform-Portable UX Layer (Discord Design System)](themes/platform-portable-ux-layer.md) — lift the UI + messaging vocabulary to the routing layer's standardization level; intent-above-Discord so it's consistent by construction + portable. _Anchored by the 2026-06-28 5-dimension UX audit; consolidates the former "Platform Abstraction Layer" + "Slash command architecture redesign" ideas. User-prioritized 2026-06-28. Council pass before plan._
- [User-feedback solicitation + revive v2 release-notes delivery](themes/user-feedback-solicitation-revive-v2-release-notes-delivery.md) — structured channel for non-direct-contact user feedback + release-notes DM blast
- [First-use onboarding DM + data-training disclosure](themes/first-use-onboarding-dm.md) — one-time system DM on first use (flag on user row, backfill-clears at ship); discloses the no-training-by-default policy (OpenRouter system-key setting disabled 2026-07-02) + BYOK; shares the system-DM primitive (characters-ignore + clearable) with the release-notes theme above
- [Shapes.inc Fetcher Hardening (multi-item mini-epic)](themes/shapes-inc-fetcher-hardening.md) — harden shapes.inc fetch against API drift, bot-protection, graceful failure
- [Security Audit Pass (discovery mini-epic)](themes/security-audit-pass.md) — systematic review of hostile-user attack surface; output is per-finding backlog items
- [Preset Cascade Standardization (multi-PR epic)](themes/preset-cascade-standardization.md) — character-tier preset editing + cross-tier cascade UX parity
- [Character Portability](themes/character-portability.md) — import/export characters and user data; users own their data _(partial — reconciled 2026-06-26: /character export + shapes-import shipped; PNG card import + sidecar prompts remain)_
- [User-Requested Features](themes/user-requested-features.md) — multi-personality channels, sidecar prompts, allowlists, emoji actions
- [Provider Prompt Caching (cost-reduction epic)](themes/provider-prompt-caching.md) — stabilize prompt prefix for provider-side caching to cut multi-turn cost
- [Model Configuration Overhaul](themes/model-configuration-overhaul.md) — first-class vision config + LLM config profiles bundling paid/free/vision
- [z.ai Catalog + 402 Error-Shape Verification](themes/zai-402-error-shape-verification.md) — capture real provider error shapes (z.ai catalog-drift, z.ai 402 subscription-lapse, OpenRouter 402 credit variants), then narrow the deliberately-broad defensive branches that shipped without samples _(gated on a real probe or production incident producing the error-shape data)_
- [Next-Gen AI Capabilities](themes/next-gen-ai-capabilities.md) — agentic scaffolding, advanced prompt features, image generation
- [Voice Engine](themes/voice-engine.md) — two-tier STT/TTS _(partial — reconciled 2026-06-26: phases 1–4.6 + pipeline resilience shipped; shapes voice import + parallel TTS chunking remain)_
- [Typing Indicator Reliability](themes/typing-indicator-reliability.md) — diagnose and fix intermittent typing-indicator dropouts during long responses _(partial — reconciled 2026-06-26: the typing-send helper shipped; the investigation + 2 sub-items remain)_
- [Observability & Telemetry](themes/observability-and-telemetry.md) — structured-log telemetry, user analytics, error-serialization audits
- [`/voice` + `/inspect` UX Polish (mini-epic)](themes/voice-inspect-ux-polish.md) — fix UX rough edges on `/voice` and `/inspect` surfaces
- [Self-Hosted TTS + BYOK Re-Evaluation](themes/self-hosted-tts-byok-re-evaluation.md) — re-evaluate TTS engines after NeuTTS Air abandoned; BYOK quality-shopping
- [Adjacent CPD Follow-Up Campaigns](themes/adjacent-cpd-follow-up-campaigns.md) — four deferred DRY-extraction campaigns from the 2026-05-16 close-out
- [Multimodal Input — file (PDF/doc) + video forwarding](themes/multimodal-input-file-video-forwarding.md) — capture/forward video + file modalities to capable models, surface in `/models`
- [Type-Assertion Audit + Deterministic Ratchet](themes/type-assertion-audit-deterministic-ratchet.md) — triage untyped casts + deterministic gate against new unsafe assertions
- [PGLite Fidelity + Real-Postgres Integration Tier](themes/pglite-fidelity-real-postgres-integration-tier.md) — harvest the remaining DDL gaps into the shared PGLite schema, provision Postgres for the integration tier, then test what PGLite structurally can't model (trigger→NOTIFY, concurrency/locking, pg.Pool)
- [Production Observability — perf metrics + distributed tracing](themes/production-observability-perf-metrics-tracing.md) — time-series metrics + tracing for load-correlated prod issues
- [Export/Import/Template/Clone Field Completeness](themes/export-import-template-clone-field-completeness.md) — derive serialize field sets from Zod schema, not hard-coded lists
