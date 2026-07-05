# Platform-Portable UX Layer — Design

> **Status**: ACCEPTED 2026-07-04 (boulder #1 design session) — council pass done (GLM 5.2 + Kimi K2.7, findings folded in); all §6 calls decided by owner
> **Companion**: [`ux-design-system-spec.md`](ux-design-system-spec.md) (part 2, ACCEPTED same day) — **the normative WHAT this machinery implements**: design-language tokens, component specs, command grammar, discoverability, `/inspect` + owner-surface dispositions. Each phase below pulls its content from the spec's §9 rollout mapping.
> **Theme**: [`backlog/cold/themes/platform-portable-ux-layer.md`](../../../backlog/cold/themes/platform-portable-ux-layer.md)
> **Supersedes**: `SLASH_COMMAND_ARCHITECTURE.md` (2025-12) — triage table in §2; file deleted with this doc's landing (git preserves it).

## 1. Design thesis

The 2026-06-28 audit found the command surface **bimodal**: routing/structure is ~90–100% standardized (via `defineCommand`, typed contexts, browse/dashboard factories), while UI components (~35%) and messaging (scattered, 60+ inline-literal files) are haphazard. The routing layer got there **without codegen** — through declarative config objects + shared builders + one compile-time-enforced invariant (`DeferredCommandContext` has no `deferReply`).

**Thesis: apply the same recipe to the two lagging layers.** No new compiler, no intent AST, no adapter framework. Three moves:

1. **Message catalog** — one intent-keyed vocabulary for every user-facing string, generalizing two patterns the codebase already validated: `USER_ERROR_MESSAGES: Record<ApiErrorCategory, string>` (common-types, enum-keyed user-facing strings decoupled from internal codes) and the `saveError.ts` outcome-honesty taxonomy (`GatewayFailureKind` → uncertain / committed-unconfirmed / genuine-failure).
2. **Complete the component vocabulary** — the existing declarative configs (`DashboardConfig<T>`, `FieldDefinition`, browse config) ARE the component-intent layer; fill the four gaps (modal adoption, detail-card builder, confirmation hierarchy, browse list-embed) instead of inventing a parallel UI framework.
3. **Enforcement** — convention-only rules become ESLint rules + a literal-adoption ratchet, using enforcement infrastructure that already exists (`@tzurot/component-handler-ack-first` proves the custom-rule path; `cpd:check` proves the ratchet path). This is the direct answer to "periodic audits aren't enough."

**Portability posture**: the intent layer is kept platform-neutral by a **dependency rule, not an adapter**: catalog + intent types import no discord.js (depcruise-enforced). That boundary is the honest 80% of portability at ~0% of the cost. A second renderer is built when a second platform exists, not before. Precedent: the dashboard SessionManager shipped Redis-hardwired without the proposed pluggable `SessionStorage` interface — goal met, speculative abstraction correctly skipped.

## 2. Grounding — what shipped since 2025-12 (proposal triage)

| 2025-12 proposal item | Verdict | Evidence |
| --- | --- | --- |
| Tier 0–3 UX taxonomy | Convention only, never encoded | No tier type/enum anywhere; adopted in §4.1 as a decision table, still not encoded |
| ADR-001 aliases as single source of truth | **Not adopted** | `PersonalityAlias` has no scope columns; `PersonalityLoader` still multi-strategy (UUID → name → slug → alias) |
| ADR-002 scoped resources (USER>GUILD>GLOBAL) | **Superseded** | `isGlobal` + `ownerId` + config-cascade resolver (`ConfigOverrides` JSONB) shipped instead |
| ADR-003 context epochs | **Shipped** | `UserPersonaHistoryConfig.lastContextReset` (+ `previousContextReset` for undo); schema comment cites the ADR |
| ADR-004 shapes import | Shipped; storage superseded | Full auth/import/export flow; credentials in Postgres `UserCredential` (AES-256-GCM), not Redis-TTL |
| ADR-005 memory semantic search | **Shipped + exceeded** | `/memory search|purge|browse|detail|stats|batchDelete|focus|incognito` |
| Redis dashboard sessions | Shipped; abstraction skipped | `DashboardSessionManager` Redis-hardwired; no `SessionStorage` interface |
| `/preset edit`, `/history`, `/memory` | Shipped | `/history` gained `hard-delete` beyond proposal |
| `/alias` commands | Not shipped | Falls with ADR-001; out of scope here |
| `/wallet` | Renamed | Lives at `/settings apikey`; gateway routes still `routes/wallet/` |
| API route renames (`/user/preset` etc.) | Never happened | `routes/user/llm-config.ts`, `routes/user/personality/` remain |

**Disposition**: the proposal is resolved-by-history. This doc mines its tier table (§4.1); ADR-001/`/alias`/route-renames are consciously NOT revived (no current pain traced to them). Delete the file once this doc merges (lifecycle rule: diverged planning docs).

## 3. Grounding — current-state inventory (2026-07-04)

### 3.1 The DSL nucleus (validated, keep, extend)

- `defineCommand` (`utils/defineCommand.ts`) + `CommandDefinition`: `data`, `deferralMode` (+ per-subcommand), `execute`, `autocomplete`, `handleButton/Modal/SelectMenu`, `componentPrefixes`. Typed contexts (`utils/commandContext/types.ts`): `DeferredCommandContext` (no `deferReply` — compile-time double-ack guard), `ModalCommandContext`, `ManualCommandContext`.
- `DashboardConfig<T>` (`utils/dashboard/types.ts`): sections with `getStatus`/`getPreview`, `SectionStatus` enum + `STATUS_EMOJI` (✅⚠️🔧❌); `buildDashboardEmbed`/`buildEditMenu`/`buildActionButtons` fully declarative.
- `ModalFactory` (`buildSectionModal`, `buildSimpleModal`, `extractModalValues`, `validateModalValues`) over `FieldDefinition` (`id/label/style/maxLength/hidden`).
- Browse stack: `createBrowseCustomIdHelpers` (typed filter/sort, `{prefix}::browse::{page}::{filter}::{sort}::{query}`), `buildBrowseButtons`, `buildBrowseSelectMenu` (numbering, 25-cap, dup guard), `truncateForSelect/Description`.
- `createListComparator`, `handlePersonalityAutocomplete`/`handlePersonaAutocomplete` + `AUTOCOMPLETE_BADGES`.

### 3.2 The gaps (this design's work items)

| # | Gap | Evidence |
| --- | --- | --- |
| G1 | No message catalog; 60+ files re-author near-identical literals | `❌`×574, `⚠`×70, `⏰`×32, `⏳`×9 (⌛ extinct); "not found" ~5 phrasings; "try again" vs "try again later" undisciplined; escaped-unicode `❌` variants |
| G2 | Retry invitations on non-idempotent writes | Only `saveError.ts` is outcome-honest; ~150 "Please try again" + ~206 "Failed to X" sites are mode-blind (duplicate-write risk — the class #1306 fixed for dashboards only) |
| G3 | In-character delivery incomplete | Generation path ALREADY in-character (`SlotDeliveryService.deliverError` → webhook + `personality.errorMessage` voice + spoiler). Bot-voice stragglers: `MultiTagCoordinator.ts:196-202` (the prod-screenshot site), `multiTagDeliveryFlow.ts:186` (truncation notice), `SlotDeliveryService.ts:210` (webhook-fail fallback), `VoiceTranscriptionService.ts:350-354` (STT ×3), `MessageHandler.ts:114` + `:532`, `PersonalityMessageHandler.ts:79` (raw `Error: ${msg}`) |
| G4 | 9 hand-rolled modal sites bypass ModalFactory | `character/create`, `preset/create` (both already iterate `FieldDefinition[]` — trivial), `persona/create`, `persona/override/set`, `settings/apikey/set`, `shapes/auth`, `deny/detailEdit`, `memory/detailModals`, `memory/purge` |
| G5 | No shared detail-card embed builder | `character/view` (own `PAGE_BUILDERS` mini-DSL — mine it), `memory/detail`, `voice/view`, `persona/view`, `deny/detail`, `shapes/detail` all hand-built |
| G6 | Confirmation: 3 implementations, 2 drifts | `deleteConfirmation.ts` (2-button, canonical Cancel→Danger) vs `destructiveConfirmation.ts` (typed-phrase, fixed `DELETE`, **Danger→Cancel**) vs `memory/purge.ts` bespoke (dynamic phrase `DELETE {NAME} MEMORIES`, **Danger→Cancel**) |
| G7 | Button-order violations ×3 | `memory/purge.ts:166`, `memory/batchDelete.ts:130`, and `destructiveConfirmation.ts:79-94` (in shared code!) |
| G8 | Custom-ID fragmentation | Three parallel conventions (`customIds.ts` per-command objects, dashboard parser, browse factory) + raw inline `split('::')` in memory purge/batchDelete |
| G9 | Browse commands still hand-build the list embed + filter row | No shared list-embed or filter-button-row builder |
| G10 | Zero UI-consistency enforcement | Only `component-handler-ack-first` + `no-singleton-export` custom rules exist; nothing checks button order, emoji, custom-id shape, factory adoption |
| G11 | Vocabulary drift | `remove` vs `delete`; `clear` overloaded destructive/non-destructive; `query` vs `search`; `kind` vs `type`; choice-sets duplicated inline |

### 3.3 The messaging substrate (generalize, don't replace)

- `USER_ERROR_MESSAGES: Record<ApiErrorCategory, string>` (common-types `constants/error.ts`) — the catalog ancestor: enum-keyed user-facing strings, decoupled from internal regex-matched codes; consumed by `buildErrorContent` + multi-tag flow. Plus `formatPersonalityErrorMessage`, `formatErrorSpoiler` (technical-detail channel), `generateErrorReferenceId`.
- `GatewayFailureKind = 'config'|'network'|'timeout'|'schema'|'http'` (`@tzurot/clients`) + `saveError.ts`: `timeout|network` → outcome-uncertain ("may still be applying… tap Refresh"), `schema` → committed-unconfirmed ("saved, couldn't read confirmation"), `http|config` → genuine failure (surface gateway message). `isSaveTimeout` deliberately keyed on kind, not status.
- Reply plumbing: `commandHelpers` (`replyWithError` prepends `❌`, `createSafeHandler`, `handleCommandError`), `replyError.ts` (component ack-state selection), `CommandHandler.sendErrorReply` + `infraAwareErrorText` (top-level catch — only sees errors that escape per-command catches). `DASHBOARD_MESSAGES` is dashboard-scoped only.
- i18n: none anywhere. The catalog is NOT an i18n system and must not grow locale machinery; it's a consistency + honesty + voice seam. (If localization ever matters, the catalog is the one place it would slot in — that's a free option, not a requirement.)

## 4. The design

### 4.1 Tier table (mined from 2025-12; decision rule, not code)

| Tier | Criteria | UX pattern | Canonical example |
| --- | --- | --- | --- |
| 0 | 1–2 fields | Inline command options | `/history clear` |
| 1 | 3–5 fields | Single modal (`buildSimpleModal` / seed-fields) | `/character create` |
| 2 | 6+ fields or sections | Dashboard (`DashboardConfig`) | `/character edit` |
| 3 | Large datasets | Search/browse + detail view | `/memory search` |

Lives in this doc + a pointer from `04-discord.md`. Not encoded in types — a `tier` metadata field on `defineCommand` would be dead weight (nothing would consume it).

### 4.2 Message catalog (keystone — Phase 1)

**Location**: `services/bot-client/src/ux/` — presentation is bot-client's domain (arch rule: gateway emits clean JSON, bot-client adds emoji). `ApiErrorCategory` + `USER_ERROR_MESSAGES` stay in common-types (they're cross-service classification); the catalog CONSUMES them.

**Structure** (two sub-layers, split enforced by depcruise):

- `src/ux/catalog/` — **platform-neutral**: intent definitions. No discord.js imports (the portability boundary, §4.6).
- `src/ux/render/` — Discord renderer: emoji prefix map, markdown, ephemeral conventions, ack-state plumbing (absorbs `replyError` / `replyWithError` mechanics).

**Intent shape** (sketch — exact TS shape at implementation):

```ts
// ux/catalog/ — no discord.js
interface MessageSpec {
  severity: 'error' | 'warning' | 'success' | 'info' | 'progress';
  /** Outcome-honesty class — drives (and constrains) the retry affordance. */
  outcome: 'failed' | 'uncertain' | 'committed-unconfirmed' | 'ok' | 'none';
  /** Rendered text, pre-emoji. Args are typed per intent. */
  text: string;
}
export const CATALOG = {
  error: {
    notFound: (entity: string): MessageSpec => ...,
    userRetryable: (what: string): MessageSpec => ...,   // "Please try again."
    transient: (what: string): MessageSpec => ...,       // "Please try again later."
    uncertainWrite: (resource: string): MessageSpec => ..., // NEVER says "try again"
    committedUnconfirmed: (resource: string): MessageSpec => ...,
    denied: (reason: string): MessageSpec => ...,
    ...
  },
  success: { saved: ..., deleted: ..., created: ... },
  progress: { working: ..., sessionExpired: ... },
} as const;
```

**Composition rule (council refinement)**: outcome classification is a **function of the error**, not a per-call-site choice. Call sites don't hand-pick `error.uncertainWrite` — they pass the caught error + resource to a classifier (`classifyGatewayFailure(error, resource) → MessageSpec`) that generalizes today's `buildDashboardSaveErrorContent` dispatcher: `timeout|network` → uncertain, `schema` → committed-unconfirmed, `http|config` → genuine failure. Individual intents stay directly addressable for non-error messages (success/progress/info). This prevents the "caller picks the wrong bucket" failure mode.

**Scope note**: bot-client has no Prisma (architecture rule) — every write it performs IS a gateway write, so "all gateway writes" is the complete write surface from bot-client's perspective; there is no uncovered local-write class.

**Voice axis**: persona-eligible intents (those that can be delivered in-character, §4.3) carry **two renderings** — a persona-register line and a system-register line — so the system fallback never speaks persona-flavored text through the bot account.

**Canonical wording decisions the catalog encodes** (settling the error-wording ideas entry):

- not-found → one shape, ending "Use autocomplete to select a valid option." where autocomplete exists.
- user-error retry → "Please try again." · infra-transient → "Please try again later."
- **outcome-uncertain / committed-unconfirmed writes NEVER render a retry invitation** — they render the `saveError.ts` shapes ("may still be applying" / "saved, tap Refresh to verify"). This generalizes `buildDashboardSaveErrorContent(error, resource)` beyond `DashboardUpdateError` to every gateway write; `GatewayResult`/`GatewayApiError.kind` (shipped in #1306) is the discriminant everywhere already.
- Emoji map (renderer-owned, single source): error ❌ · warning ⚠️ · success ✅ · progress/slow ⏳ · session-expiry ⏰ · loading 🔄. Kills the `❌` escapes and freelance variants.

**Adoption mechanics**: migrate `DASHBOARD_MESSAGES` + `commandHelpers` message fns onto the catalog first (instant coverage of every consumer of those helpers), then sweep the inline-literal files. Full sweep is large (~60 files) — the **ratchet** (§4.5) lets adoption land incrementally without regressing.

### 4.3 In-character error delivery (Phase 1, with §4.2)

**Finding that reframes the requirement**: the generation path already delivers errors in-character (webhook as persona, `personality.errorMessage` voice, spoilered technical detail). The work is finishing the stragglers, not building a mechanism.

**Mechanism decision (recommended)**: canned catalog lines delivered through the persona webhook — NOT LLM-generated apologies. Rationale: failure-during-failure — the provider that just failed is the one you'd be asking; latency/cost on the error path; and the immersion win is mostly the delivery channel (character name + avatar) plus register-neutral wording, both of which canned lines provide. The existing `personality.errorMessage` per-persona line already gives per-character voice; the catalog supplies the generic-but-in-tone fallback.

**The voice boundary (council refinement — needed an explicit line, or drift returns)**:

- **Policy denials** (NSFW gate, permissions, denylist) → **system voice**, always. The user must know the SYSTEM denied; a character delivering a policy denial reads as the character being coy.
- **Capacity/capability limits** (rate limits, provider slowness, generation caps hit mid-conversation) → **persona-eligible**. These are the immersion-breaking cases the directive targets.
- **Pre-persona failures** (STT on the user's own message, top-level dispatch errors) → system voice; no persona has engaged yet.

**Fallback attribution (council refinement)**: when a persona-eligible notice can't go through the webhook (webhook down/rate-limited), the fallback is a plain bot reply using the intent's **system-register rendering** prefixed with the persona's display name — `**{displayName}:** …` — reusing the exact convention the DM path already uses. Scene continuity degrades gracefully instead of snapping to an anonymous bot notice.

**Site dispositions**:

| Site | Disposition |
| --- | --- |
| `MultiTagCoordinator.ts:196-202` (all-slots infra/denied — the prod-screenshot site) | Infra/error variant → **each errored persona replies in-character with its own error line** (owner decision, §6: generalizes the "each character replies when tagged" invariant to failure; the per-slot `deliverError` path already exists — the aggregate system notice is replaced by per-slot delivery). The all-*denied* variant stays a single system notice — denied characters must not engage at all (an in-character reply would leak engagement where the character is restricted) |
| `SlotDeliveryService.ts:210` (webhook send failed) | Stays bot-voice reply — the webhook path just failed; this IS the failure-during-failure fallback. Wording via catalog |
| `VoiceTranscriptionService.ts:350-354` (STT ×3) | System-voiced by design — no persona has engaged yet (the user's own message failed to transcribe). Wording via catalog |
| `MessageHandler.ts:114` (top-level catch), `:532` (channel.send last resort) | System-voiced fallbacks — persona context unavailable/unreliable at these points. Catalog wording |
| `PersonalityMessageHandler.ts:79` (`Error: ${errorMessage}` raw) | Fix regardless: raw error text to users is a leak. In-character if personality is in scope there, else catalog system line |
| `multiTagDeliveryFlow.ts:186` (truncation notice) | Informational, not an error — keep system-voiced italic, move string to catalog |
| Slash-command surface (all of `commands/`) | **Stays system-voiced** — utility surface, mostly ephemeral, no persona in scope. In-character applies to the conversational/persona surface only |
| Hard denials (NSFW gate, permissions, denylist) | **Stay system-voiced** — the user must know the SYSTEM denied, not wonder if the character is being coy. (Multi-tag "all unavailable" is a denial-shaped case: system voice is defensible there even if the infra variant goes in-character) |

### 4.4 Component vocabulary completion (Phase 2)

1. **Confirmation hierarchy** — two tiers, one module:
   - Tier A `confirmAction` (simple 2-button): current `buildDeleteConfirmation`, generalized naming (also for non-delete destructive acts).
   - Tier B `confirmDestructive` (typed-phrase): merge `destructiveConfirmation.ts` + the `memory/purge.ts` bespoke copy. Phrase format standardized to the **dynamic** form (`DELETE {NAME} MEMORIES`-style) — it's strictly better friction for high-stakes ops; fixed `'DELETE'` remains as the parameterized default. One modal-mismatch handler (ephemeral reply + best-effort parent edit).
   - **Shape constraint (council)**: both tiers stay *component factories* (build the embed/rows/modal) plus small handler helpers — the current `destructiveConfirmation` split (`buildDestructiveWarning` / `validateConfirmationPhrase` / `handleDestructiveModalSubmit(interaction, expected, executeOperation)`, one callback) is the right shape. If the merge starts wanting `onConfirm`/`onCancel`/`validator` callbacks on one mega-helper, that's the 2-callback ceiling saying stop.
   - Button order fixed to Cancel→Danger in ALL THREE current sites including the shared helper (G7). The violation living in shared code is itself a smell — during the merge, check whether that helper absorbed call-site concerns it shouldn't own.
2. **Detail-card builder** — `buildDetailEmbed(config, data)` sharing the `SectionDefinition`-ish accessor pattern; mine `character/view.ts`'s `PAGE_BUILDERS` pagination mini-DSL for the multi-page variant. Retrofit the 6 hand-built sites.
3. **Modal adoption** — migrate the 9 hand-rolled sites onto `buildSimpleModal`/`buildSectionModal` **where the factory fits, per-site** (council caveat: 9 hand-rolls may mean the factory is missing shapes those sites need). `character/create` + `preset/create` are proven fits (already `FieldDefinition[]`-shaped); for the rest, extend the factory with a concrete variant where reasonable, and leave a site hand-rolled if fitting it would need >2 callback params. `memory/purge`'s modal folds into Tier B confirmation.
4. **Browse completion** — shared list-embed builder + filter-button-row builder (G9), closing the last hand-written part of browse commands.
5. **Absorbed audit criteria** (from the UX-consistency ideas entry): post-action re-render must preserve navigation buttons (the `/preset browse` back-button-loss class) — becomes an acceptance criterion on the detail/browse builders; **Close-button removal from ephemeral dashboards** (native dismiss suffices; verify per-session-type that TTL expiry holds no scarce resources) — lands with the confirmation/dashboard touch; parameter-ordering review stays a per-command checklist item in Phase 3's sweep.

### 4.5 Vocabulary + enforcement (Phase 3)

**Vocabulary constants** (common-types or bot-client constants):

- Verb taxonomy: `delete` = destructive removal of an entity; `remove` = detaching an entry from a list (deny); `clear` = resetting state, NEVER data deletion (history clear is epoch-based = compliant; audit `clear` uses against this rule).
- Option names: `query` (not `search`) for text filters; `type` vs `kind` — pick per domain and freeze; shared choice-set consts (timeframes, filters) following `deny/index.ts`'s exemplar.
- Custom-ID unification (G8): one generic factory in `utils/customIds.ts` that the dashboard parser + browse factory + per-command objects all sit on; kill raw `split('::')`.

**Enforcement** (the "audits aren't enough" answer; every rule mechanically checkable):

| Rule | Mechanism |
| --- | --- |
| No `new ModalBuilder()` outside `ux/`/`ModalFactory` | ESLint `no-restricted-syntax` scoped to `commands/**` (allowlist during migration) |
| Danger-style button never precedes non-Danger in a row | Custom ESLint rule (same infra as `component-handler-ack-first`) |
| No raw `.split('::')` on customIds outside the factory | ESLint `no-restricted-syntax` |
| Catalog adoption (no raw user-facing literals) | **Two-stage (council synthesis)**. Phase 1: emoji-prefixed-literal grep ratchet in `commands/**` (baseline, must-not-grow, burn down — cheap regression brake while adoption is underway; cpd:check pattern). Phase 3: AST-based ESLint rule targeting the real invariant — raw string literals passed as `content` to messaging calls (`reply`/`editReply`/`followUp`) must come from the catalog, with a grandfathered allowlist that only shrinks. The grep ratchet retires when the AST rule lands (one mechanism, not two, at steady state) |
| `ux/catalog/` imports no discord.js | depcruise rule (§4.6) |

### 4.6 Portability posture (Phase 4 = a boundary, not a build)

- **Now**: `ux/catalog/` (and any extracted intent types) carry zero discord.js imports — depcruise-enforced from day one. Component intents remain the declarative config objects; their types may keep discord.js references until a real second platform forces extraction.
- **Markdown pragmatism (council)**: "platform-neutral" means no discord.js *imports/types* — it does NOT mean scrubbing Discord-flavored markdown, mentions, or `<t:…>` timestamps out of catalog *strings*. Contorting templates into placeholder soup to keep strings "pure" would degrade the first platform's UX for a hypothetical second one; markup translation is a future adapter's job. The renderer stays a thin function layer (no class hierarchy) so a second renderer is a small addition, not a refactor.
- **Later (trigger-gated)**: a second renderer/adapter is built when a concrete second platform (web UI, Revolt, …) is scheduled — not speculatively. The ~40–50% irreducible Discord.js surface is the adapter boundary line, exactly as the 2026-04-13 investigation framed it.
- **Explicitly rejected**: codegen / schema-compiler abstraction depth. The routing layer reached ~100% consistency with plain TS config objects + builders; a compiler adds a debugging indirection layer to a 14-command bot and violates the "crystallize validated patterns" constraint.

## 5. Phasing

| Phase | Contents | Discharges |
| --- | --- | --- |
| **1 — catalog + voice** | `ux/catalog` + `ux/render`; migrate `DASHBOARD_MESSAGES`/`commandHelpers`/`saveError` onto it; generalize outcome-honesty to all gateway writes (G2 audit of "try again" on writes); in-character straggler sites (§4.3); ratchet baseline established | in-character directive; error-wording entry; failure-mode-honesty entry |
| **2 — components** | Confirmation hierarchy merge + button-order fixes; detail-card builder + retrofit; modal adoption ×9; browse list-embed/filter-row; Close-button removal; post-action button-preservation criterion | modal dedup (~400→~80 LOC); G5–G7, G9; two UX-audit criteria |
| **3 — vocabulary + enforcement** | Verb taxonomy + option/choice-set constants; custom-ID unification; the ESLint rules + depcruise boundary + literal ratchet wired into CI | G8, G10, G11; parameter-ordering sweep |
| **4 — adapter (gated)** | Second renderer only when a second platform is scheduled | portability proof |

Phases 1–3 are each a small PR train (catalog core → migrations → sweep), not monoliths. Phase order is by user-visible value; 2 and 3 could interleave.

## 6. Open calls — council verdicts (GLM 5.2 + Kimi K2.7, 2026-07-04) → owner decision

| # | Call | Council | Status |
| --- | --- | --- | --- |
| 1 | Abstraction depth | **Unanimous: thin builders + catalog.** Codegen/schema-compiler = speculative infra; routing succeeded declaratively within TS | **CONFIRMED 2026-07-04** |
| 2 | Portability posture | **Unanimous: depcruise-boundary-only**, adapter trigger-gated; + markdown pragmatism (§4.6) and thin-function renderer | **CONFIRMED 2026-07-04** |
| 3a | In-character mechanism | **Unanimous: canned-through-webhook** (LLM on the error path = failure-during-failure) | **CONFIRMED 2026-07-04** |
| 3b | **Multi-tag all-failed voice** | Council SPLIT (GLM: system — no persona owns a systemic failure; Kimi: first-tagged — scene continuity). **Owner decided a third way: ALL errored personas reply, each with its own in-character error line** — consistent with "each character replies when tagged"; verbose but bounded by `MULTI_TAG.MAX_TAGS`, and it dissolves the ownership question (each persona owns its own failure). All-denied variant stays one system notice (§4.3) | **DECIDED 2026-07-04** |
| 4 | Catalog location | **Unanimous: `bot-client/src/ux/`** — new package is versioning/build overhead for zero second consumers | **CONFIRMED 2026-07-04** |
| 5 | Adoption enforcement | Split on mechanism → **synthesized two-stage** (§4.5): grep ratchet Phase 1, AST rule Phase 3, grep retires | **CONFIRMED 2026-07-04** |
| 6 | 2025-12 proposal file | Delete — lifecycle rule for diverged planning docs (deleted with this doc's landing; `prisma/schema.prisma:434`'s stale pointer to it rides the next schema-touching PR) | **DECIDED 2026-07-04** |

**Council findings absorbed elsewhere**: outcome-classifier composition + voice axis + dual renderings (§4.2), voice boundary + fallback attribution (§4.3), confirmation shape constraint + per-site modal fit test (§4.4), markdown pragmatism (§4.6). **Finding deliberately NOT absorbed**: Kimi's "pair honest messages with idempotency keys on non-idempotent gateway writes" — correct but a gateway API-layer change outside this theme's scope; filed as a backlog idea (§7). Precedent exists (`memory/purge`'s two-step `issuePurgeToken` handshake).

## 7. Backlog additions required (at finalize)

- Theme file: link this artifact; mark Phase sketch → superseded by §5.
- `cold/ideas.md`: in-character entry + error-wording entry get "design landed → see artifact" pointers (they remain requirement records until their phases ship).
- The G2 write-path retry audit and the Close-button session-teardown verification become named Phase-1/2 work items (tracked in the theme, not as separate follow-ups).
- NEW `cold/ideas.md` entry (from council): **idempotency keys for non-idempotent gateway writes** — reduce the outcome-uncertain class at the source (at-most-once tokens on create/delete/purge-style routes; `memory/purge`'s `issuePurgeToken` handshake is the in-repo precedent). Promote when: a duplicate-write incident, or when generalizing the outcome-honesty classifier surfaces a route where "uncertain" is common in practice.
