### Theme: Adjacent CPD Follow-Up Campaigns (deferred from 2026-05-16 campaign close-out)

_Focus: four distinct DRY-extraction campaigns that the api-gateway CRUD-config campaign explicitly LEFT for separate council passes. Each is independently scoped; none are bugs — all are opportunities surfaced and classified during the 2026-05-16 audit (see [`docs/reference/CPD_CAMPAIGN_AUDIT.md`](../../../docs/reference/CPD_CAMPAIGN_AUDIT.md))._

The campaign-close audit at `docs/reference/CPD_CAMPAIGN_AUDIT.md` classifies the remaining post-filter clones into four buckets. Three of those buckets are out-of-scope-by-design (deferred to future campaigns); one is in-file local-helper work. Picking these up individually:

1. ~~**🟣 Service-layer parallel cleanup**~~ — **OBSOLETE 2026-07-06 (verified, not done)**: the kind-column retirement (#1499/#1501) restructured LlmConfigService enough that raw jscpd now finds ZERO clones between the pair; the parallel method names remain but the implementations diverged structurally (ModelSlot-parameterized defaults vs slotless TTS pointers, checkNameExists vs resolveNonCollidingName). The council question answered itself: the divergences ARE structural. No extraction. (original scope: ~24 lines / 2 clones)
   - `services/api-gateway/src/services/LlmConfigService.ts` ↔ `TtsConfigService.ts`
   - Sibling service implementations with shared structure (CRUD methods, scope-aware lookups, cache invalidation, error classes)
   - **Lowest blast radius** of the four. The helpers from PR #1039-1041 are at the ROUTE layer; this campaign would be the analogous extraction one level deeper. Some helpers may apply directly (`checkNameExists` is already parameterized).
   - Council pass should focus on: which divergences are caller-policy vs structural? Are `AutoSuffixCollisionError` ↔ `TtsAutoSuffixCollisionError` (LLM/TTS) and other error class pairs worth unifying with a discriminated-result type?

2. **🟡 api-gateway override-route campaign** (~49 lines / 4 clones between `model-override` ↔ `tts-override`, plus internal clones in `stt-override`, `voice-resolution`, `config-overrides`)
   - `services/api-gateway/src/routes/user/{tts,stt,model}-override.ts`
   - **Explicitly flagged as DIFFERENT shape than CRUD** by Kimi K2.6 and GLM 5.1 during 2026-05-16 council review. Cascade-override semantics set/clear values on a personality-scoped key; not row-based CRUD. Forcing CRUD helpers (`findConfigOrSendNotFound`, `ensureNoNameCollision`) here would be the Wrong Abstraction trap.
   - Boundary documented in `.claude/rules/02-code-standards.md` "Config Route Helpers" section.
   - Council pass should focus on: what's the cascade-override helper kernel? `mergeAndValidateOverrides` already exists in `configOverrideHelpers.ts` — what else generalizes?

3. **🟡 bot-client command-pattern campaign** (~221 lines / 11 clones — the largest cluster)
   - Top pairs: `character/overrides` ↔ `character/settings` (93 lines), `character/truncationWarning` ↔ `persona/truncationWarning` (88 lines), `commands/settings/preset/autocomplete` ↔ `commands/voice/tts/autocomplete` (38 + 27 lines)
   - Discord.js command paradigm. Different concerns than api-gateway routes (option-builder, interaction handlers, deferReply 3-second budget). Existing utilities in `services/bot-client/src/utils/` already cover some patterns (browse, dashboard, autocomplete) — incremental extraction continues that work.
   - **Largest remaining cluster** by lines, but most architecturally different from what was just done.
   - Council pass should focus on: which command groupings genuinely share helper-extractable shape? `character/*` siblings probably yes; `character/truncationWarning` ↔ `persona/truncationWarning` looks ripe.

4. ✅ **🟣 ai-worker service-pattern campaign** — **SHIPPED 2026-07-06** (council pass: composed `CloneCacheKernel` over BaseTtsProvider inheritance — the failure classifiers have near-opposite polarity per provider and are load-bearing divergence; the three-cache state machine (positive/negative/inflight + finally-cleanup) is the identical-invariant kernel that must stay in sync. Exactly 2 callbacks (work + classifyFailure); Mistral's eviction mutex stays a provider lifecycle concern. Both provider suites passed UNCHANGED post-extraction; pair clones now 0. Internal `KeyValidationService`/`ElevenLabsClient` self-clones remain item-5 material.)
   - `services/ai-worker/src/services/voice/ElevenLabsVoiceService.ts` ↔ `voice/providers/MistralTtsProvider.ts`
   - Voice provider abstraction was deliberately additive during the TTS Phase 1+3 work — each provider implements `TtsProvider` independently. Cross-provider duplication has accumulated.
   - Council pass should focus on: is the `TtsProvider` interface incomplete? Should there be a `BaseTtsProvider` with shared concerns (cost telemetry, fallback wiring) and provider-specific subclasses for inference?

**Plus a non-campaign-shaped item:**

5. **🔵 In-file local-helper extraction sweep** — 10 file pairs from the audit are SAME-file internal clones (`user/history.ts` self, `user/memorySingle.ts` self, `SettingsDashboardHandler` self, `ElevenLabsClient` self, etc., totaling ~339 lines). These are repeated guards/loops within single handlers that local-helper extraction would clean up. Per-file work, not a campaign — surface for opportunistic cleanup when next touching each file.

**Sequencing**: Item 1 obsolete, item 4 shipped (2026-07-06). Item 2 (override-routes) is gated on a council design pass for the cascade-helper kernel shape. Item 3 (bot-client) is the largest but most architecturally distinct — would benefit from its own multi-PR shape. Item 4 (ai-worker voice providers) is the smallest and could be a single PR.

**Promote when**: capacity for another DRY-extraction campaign exists, OR opportunistically when next touching the relevant code. Each item gets its own council pass before plan-mode per the project's "consult council before major refactors" rule.

**Start**: read `docs/reference/CPD_CAMPAIGN_AUDIT.md` for the full pair-by-pair classification + `.claude/rules/02-code-standards.md` "Duplication, Helpers, and the CPD Ratchet" section for the 2-callback ceiling rule that governs all future extraction decisions.
