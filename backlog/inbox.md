## 📥 Inbox

_New items go here. Triage to appropriate section weekly._

### `[FEAT]` `/models` v2 — sorting + curation

**Surfaced 2026-06-14 (user)**, reviewing the `/models` v1 (#1212, shipped). v1 is browse/view + user-aware usability + z.ai merge + all ~337 models. v2 makes browse genuinely useful:

1. **Sort by price** — cheapest-first (free → paid → variable/routers last). Data's already on `ModelAutocompleteOption` (`promptPricePerMillion`).
2. **Sort by recency** — "recently released" via OpenRouter's `created` timestamp. **Needs plumbing**: `created` is in the raw `/models` payload but dropped by `toAutocompleteOption` (`OpenRouterModelCache.ts`) — thread it through `ModelAutocompleteOption` → `CatalogModel`.
3. **Global-preset models first** — surface models used by Tzurot's global presets at the top of the default view. Fetch via `userClient.listUserLlmConfigs()` (returns owned + global with `model`), prioritize set membership.
- Adding a `sort` option means switching `browse`'s customId helper from `includeSort: false` to a custom sort union (`createBrowseCustomIdHelpers` overload 2 supports it).

**Bonus / carried review nits** (fold in while touching these files):
- `zaiDisplayName` (`modelCatalog.ts`) uppercases whole slug → title-case dash segments (only affects future z.ai-only qualifier models; glm-5.2 renders fine today).
- `fetchCatalogModelById` uses the implicit 100 default — make `limit` explicit (1000) or comment why it's sufficient.
- `handleBrowse` capability/search path is untested (filtering is covered in `modelCatalog.test`, but the handler pass-through isn't); add a case.
- Optional 🔀 **router badge** for `top_provider.context_length === null` models (auto/fusion/etc.) — distinguishes meta-routers from concrete models in the list.

**Explicitly NOT in scope**: availability filtering. Confirmed moot — OpenRouter's `/models` only lists available models (every model has free or paid pricing; "zero providers" isn't in the bulk payload anyway).

### `[LIFT]` Type-assertion audit — triage sketchy casts, adopt a deterministic ratchet

**Surfaced 2026-06-12 (user)** after PR #1192 (the `content as string` fix) — that cast was hiding a real type hole (`buildBaseComponents` returned `{ content: unknown }`, caught by tsc the moment the cast came out). Census of production code (tests excluded): **65 `as unknown as`** double-casts (full type-system bypass; some are test infra under `src/` — Discord mocks, conformance harness — but production hits include `ai-worker/jobs/AIJobProcessor.ts` ×3, `bot-client/utils/browse/customIdFactory.ts` ×3, the dashboard settings builders, `fetchTypingChannel.ts`), **1 `as never`** (`settingsUpdateFactory.ts:75`), **~416 total `as Type` assertions** never triaged. Same shape as the CPD story: a noisy raw metric needing a classifier + ratchet, not a grep.

**Scope**: (1) triage the `as unknown as` production set — each is either a legit boundary (document why, à la suppression-justification standards in `02-code-standards.md`) or a latent hole (fix); (2) adopt a deterministic gate so new unsafe assertions can't land silently.

**Tool candidates (training-data priors — REQUIRE live web verification per the research-method convention; verify current names/maturity/vitest-ESLint-version fit before adopting):**
1. **`@typescript-eslint/no-unsafe-type-assertion`** — ESLint rule flagging assertions not provably safe; would slot into the existing lint pipeline with a baseline/ratchet like cpd. Likely the primary candidate.
2. **`@typescript-eslint/consistent-type-assertions`** — can restrict assertion styles (e.g., forbid `as` outside `as const`).
3. **`type-coverage`** (`--strict` counts type assertions; percentage metric with `--at-least` threshold) — ratchetable in CI exactly like the cpd/test-audit baselines.
4. **ast-grep** for structural search during the triage itself (regex grep over-/under-matches casts).

**Why a LIFT**: the triage pass is cross-cutting (all three services + packages), and the ratchet adoption follows the established audit-tool checklist (`docs/reference/audit-enforcement.md` — WHY.md, canary, baseline-meta contract) if it graduates to an audit-class gate. Complements (same family as) the `[RESEARCH]` deterministic-test-tooling spike below — both are "make the unsafe thing impossible to land silently."

### `[RESEARCH]` Deterministic test-quality tooling — evaluate mutation testing + a job-payload contract layer

**Surfaced 2026-06-11** (user) after the iii-b-2 thin-payload referenced-attachment regression (#1184): `jobChainOrchestrator` **had** a referenced-attachment test, and line coverage was green — but it covered only the _fat_ payload shape, so a new wire-shape shipped broken. Three green units, one broken cross-service seam. User's framing: unit tests are repeatedly insufficient for seam/wiring bugs; rules that depend on contributor/agent attention are not a safety net (the AI agent is non-deterministic by construction); we want **deterministic checks that fail the build**. We already have strong deterministic gates (cpd ratchet, test-audit, depcruise, conformance harness, codecov) — this is about filling the remaining rungs.

**Candidates to evaluate (with honest scope of what each catches):**

1. **Mutation testing — StrykerJS** _(highest-leverage general tool)._ Line coverage measures code-_ran_, not bug-_caught_. Stryker mutates code (flip conditionals, delete statements, swap `??`/`&&`) and checks whether a test fails → grades test _effectiveness_, surfacing tautological/weak tests suite-wide. **Caveat**: catches weak tests, NOT missing code paths — it would not have caught #1184 directly (that was a missing path), but it's the best deterministic answer to "are our tests a real net." Pilot: run on one package (e.g. `common-types` schemas or a service's core logic), set a mutation-score threshold, ratchet in CI like cpd/test-audit. **This is the recommended starting point.**
2. **Job-payload contract / property suite at the bot→gateway→worker BullMQ seam** _(targeted at the #1184 class)._ Assert: every valid context shape (`legacy` / `envelope` / `envelope`+referenced-attachments) → correct job-chain → correctly consumed by the worker's `ValidationStep`/pipeline. Consider **fast-check** (property-based) to generate shapes rather than hand-enumerate. Homegrown, deterministic, not large. This is the rung that catches wire-shape regressions.
3. **Evaluate Pact (consumer-driven contracts)** — likely an awkward fit (our seam is internal BullMQ, not HTTP between deployed services); quick rule-in/out, not a commitment.
4. **More compiler-enforced invariants** — the `ContextVariant` discriminated union (PR #1183) is the cheapest deterministic check (illegal states won't compile); audit for more "make it unrepresentable" spots.

**Outcome of the spike**: decide what to adopt as CI ratchets. Likely answer: Stryker (suite-wide floor) + the job-payload contract test (seam-specific). Complements (does not replace) the `00-critical.md` "fix failures structurally: hook > rule > memory" ordering — push toward the deterministic end.

**Method (REQUIRED)**: the spike must do **actual web research**, not lean on training-data priors. The candidate list above came from the agent's training data and is unverified — current tool maturity, latest versions, vitest/ESM integration status, performance on a monorepo this size, and whether better alternatives have emerged all need live verification (web search + the tools' own docs/changelogs) before any adoption decision. Treat the names above as a starting map to confirm/refute, not a recommendation.

### `[RESEARCH]` Production observability — performance metrics + distributed tracing (stop flying blind)

**Surfaced 2026-06-11 (user)** from the preset-PUT-timeout prod bug (production-issues.md): intermittent, **load-correlated** issues can't be reproduced in dev (single dev user, no load) and aren't visible in event logs — we log _what happened_ but have ~no aggregated _performance_ signal. User wants real insight + a foundation for scaling without "miserable growing pains." This is the perf analog of the `[RESEARCH]` test-tooling item — continuous/deterministic insight infrastructure, not repro-and-guess.

**What we have**: pino structured logs → Railway; per-request `responseTime` _is_ logged by the gateway HTTP logger (that's how the preset bug was caught) but never aggregated/alerted. Railway exposes infra metrics (CPU/mem) but no app-level tracing.

**What's missing**: (1) **time-series metrics** — p50/p95/p99 latency per route, DB query duration, Prisma connection-pool utilization, BullMQ queue depth + job durations, error rates; (2) **distributed tracing** — per-request span breakdown (handler → DB → cache → response), i.e. THE tool that would show exactly where the preset PUT's 10s goes; (3) dashboards + alerting (p99 spike, error-rate).

**Candidate approach (to web-research, NOT assume)**: OpenTelemetry (vendor-neutral Node SDK; auto-instrumentation exists for Express/Prisma/ioredis/BullMQ → captures DB query times, Redis ops, queue jobs with minimal manual code) → export to a backend. Evaluate backends for a small Railway project on cost/effort: free-tier hosted (Grafana Cloud / Honeycomb free / Axiom / Sentry Performance) vs self-hosted Grafana+Tempo+Prometheus. Prisma has built-in metrics + OTel tracing hooks; `prom-client` for custom metrics.

**Interim (cheaper, directly cracks the preset bug)**: targeted timing instrumentation shipped to the **prod** llm-config PUT path (it only repros under prod load) — breakdown log: validate / DB write / cache-invalidation / total. The forward-bug diagnostic pattern: ship the probe to prod, read the runtime observation, then fix.

**Method (REQUIRED)**: actual web research — current OTel-on-Node maturity, auto-instrumentation coverage for OUR stack (Express/Prisma/ioredis/BullMQ), and real cost/effort of the backend options. Don't lean on training-data priors.

**Outcome**: pick a LEAN starting point (likely OTel + auto-instrumentation + one free-tier backend, focused first on gateway request latency + Prisma query times), wire it, build a latency dashboard + a p99 alert. Foundation for scale. Likely graduates from inbox to a `future-themes` initiative once scoped.

### `[LIFT]` Audit import/export/template/clone field completeness — derive from schema, kill hard-coded field lists

**Surfaced 2026-06-11 (user)** while editing presets. `/preset export` builds its JSON from a **hard-coded** `EXPORT_FIELDS` list (`services/bot-client/src/commands/preset/export.ts:20` — name/description/provider/model/visionModel/contextWindowTokens), plus hard-coded `SAMPLING_PARAMS` and `REASONING_PARAMS`. Add a field to the llm-config schema and it **silently won't export** unless someone manually updates the list → drift-prone data loss, exactly the brittle hard-coding the user wants to systematically kill. (Trigger: user noticed `isGlobal`/public-private isn't exported — that one IS intentional per the `export.ts:16-18` comment, "dashboard toggle" — but it surfaced the broader pattern.)

**Scope** — enumerate every serialize/deserialize/template/clone surface and check whether its field set is **schema-derived (single source of truth)** or hand-listed:
1. Preset export/import/clone: `export.ts` (`EXPORT_FIELDS`/`SAMPLING_PARAMS`/`REASONING_PARAMS`), the import counterpart, `createClonedPreset` (`cloneName.ts`).
2. Any other export/import/template: personality export/import, shapes import, config templates/defaults, TTS-config equivalents.
3. For each hand-listed set: flag it; prefer deriving from the Zod schema (e.g. a co-located "exportable projection" or `schema.keyof` introspection) so a new schema field defaults to **included**. Where exclusion is deliberate (computed/server-side fields, `isGlobal`), make it an explicit **deny-list against the schema's full key set** — fail-open-to-completeness, not fail-closed-to-silent-omission.

**Confirmed cross-surface inconsistency (the real lead)**: **characters round-trip visibility, presets don't.** `character/export.ts` `EXPORT_FIELDS` **includes `isPublic`** and `character/import.ts` reads it back (shows 🌐/🔒); preset export **excludes `isGlobal`**. Same concept, opposite handling — and the preset exclusion's "dashboard toggle" rationale applies equally to characters (which also have a visibility toggle) yet they export it. So it's an arbitrary divergence, not a principled one. **Reconcile to one policy** (lean: match characters — round-trip visibility through export/import for presets too, since preserving public/private on re-import is the more complete and expected behavior). General principle: the same field/concept should be handled the same way across every export/import surface.

**Why a LIFT**: cross-cutting (export/import/template/clone surfaces + possibly the schema layer); the per-surface fix (schema-derived projection) is small but needs the full enumeration first. Same brittle-hardcoding class we've hit repeatedly — worth killing structurally.

### `[LIFT]` Audit slash-command timeout handling for consistency (Discord 3s ack + downstream timeouts)

**Surfaced 2026-06-11 (user)** after a prod session where the api-gateway felt slow on less-common commands (preset edit/import/export, setting default presets personal + global). Suspicion: command-processing or gateway-call timeouts may be inconsistent across commands, or too short for the slower paths — a problem we've hit before. The Discord 3s-ack rule is well-documented (`04-discord.md`: defer-first), but the **downstream** timeouts (gateway `fetch`/`callGatewayApi`/`adminFetch` request timeouts, BullMQ result-wait windows, per-command budgets) may not be applied consistently.

**Scope**:
1. Enumerate every slash-command path's async budget: deferral → gateway request timeout → any BullMQ result-wait → where each value comes from (shared constant vs hardcoded vs implicit default).
2. Find inconsistencies — structurally-similar commands using different/implicit timeouts; flag any with no explicit timeout (inheriting a possibly-too-short default).
3. Decide a consistent policy (shared timeout constants per operation class: fast-read vs write vs import) and centralize.
4. Anchor against evidence: the prod-log dig (below) will name which commands/endpoints were actually slow — the audit and the logs inform each other.

**Why a LIFT**: cross-cutting consistency audit (command layer + gateway client + timeout constants), not a one-line fix. Pair with the prod-log investigation of the preset-command issues.

### `[LIFT]` Audit message-content extraction paths — confirm single source, document the layering, find re-derivation footguns

**Surfaced 2026-06-08** during the forwarded-trigger-empty-content investigation (see `backlog/production-issues.md`). The forward bug existed because `ReferenceExtractor` **re-derived** message content from `message.content` (empty for forwards) for its link-replacement step, silently clobbering the already-correctly-extracted forwarded text — a redundant second derivation that bypassed the shared extractor. The raw extraction itself is NOT duplicated (`getEffectiveContent` and `buildMessageContent` both bottom out in `extractForwardedContent`), but the layering is undocumented and the re-derivation footgun was invisible until it shipped a prod bug.

**Scope** (do NOT big-bang-merge `getEffectiveContent` and `buildMessageContent` — they serve different purposes: raw-text-for-rewriting vs rendered-content-for-display; merging would run mention-rewriting over attachment descriptions):
1. Enumerate every place that extracts a message's text content (`getEffectiveContent`, `buildMessageContent`, `ReferenceExtractor`, `DiscordChannelFetcher.convertMessage`, `ConversationPersistence`, `RawEnvelopeBuilder`, sync's `collateContentForSync`, etc.).
2. Confirm each flows from the one `extractForwardedContent` for forward text, and flag any that re-derive from `message.content` instead of using passed/authoritative content (the ReferenceExtractor class of bug).
3. Document the layering explicitly: raw-text path (trigger → rewriting) vs rendered path (history/display) vs persistence — and which is authoritative when they disagree.
4. Capture the **gateway-vs-REST snapshot asymmetry** as a first-class fact: forward snapshot content is present on the live `MESSAGE_CREATE` but absent on REST re-fetch (so any history/refetch path that expects forward content will get empty). Decide where this belongs (a code comment in `forwardedMessageUtils.ts`, or `docs/reference/`).
5. Consider structural enforcement: required-param contracts (no silent `message.content` defaults) wherever content-rewriting takes a base text.

**Why a LIFT, not a quick fix**: the immediate forward bug gets a targeted fix; this audit is the systematic follow-up that prevents the next divergence, scoped after the fix lands so it has a concrete anchor.

### `[FEAT]` Enrich forwarded-message context with origin channel/thread (not just forwarding channel)

`SnapshotFormatter.formatSnapshot` (`services/bot-client/src/handlers/references/SnapshotFormatter.ts`) currently labels forwarded snapshots with the **forwarding** channel's `locationContext` + "(forwarded message)" — it does NOT surface the _origin_ channel/thread the message was forwarded FROM. The inline comment ("snapshot doesn't have it") is accurate about the snapshot object, but the origin `channelId`/`guildId` ARE available on `forwardedFrom.reference` (the `FORWARD`-type `MessageReference`). Discord's own client resolves that ID to show e.g. "#general · 05/09/2026" on the forward. The original **timestamp** is already captured (`snapshot.createdTimestamp`, falls back to the forward's time) — only the origin location is missing.

**Fix shape**: read `forwardedFrom.reference?.channelId` / `.guildId`; best-effort resolve the channel name via `client.channels.fetch()` and include it in `locationContext` (e.g. "forwarded from #general"). **Hard caveat**: Discord allows cross-server forwards, and the bot often won't be a member of the origin guild/channel → the fetch fails. Must degrade gracefully (bare ID, or omit) rather than throw or stall. Worth weighing whether a bare channel ID adds any value to the AI's context vs. just noise — possibly only include when the name resolves.

**Why minor**: forwarded-message origin is situational-awareness nice-to-have for the AI, not a correctness issue; the content, timestamp, attachments, and embeds are all already captured. User-flagged 2026-05-29 as explicitly out-of-scope for the current release.

### `[LIFT]` Split `/character chat`'s random mode into a separate `/character random` command

**Surfaced 2026-05-29** (user). `/character chat` is currently trimodal — (1) chat with a named character + message, (2) weigh-in mode (named character, no message), (3) random-pick (no character → picks one). The combined surface is confusing for the average user: it's not obvious from the signature which mode you're invoking, and "omit the character to get a random one" is easy to miss or trigger by accident.

**Direction (user)**: pull random-pick into its own `/character random` command so each command's purpose is legible from its name. **Keep weigh-in mode in `/character chat`** — it still requires picking a character, so it fits the "chat" mental model. Goal: split with zero loss of current functionality.

**Open design question**: does `/character random` get the optional `message` arg (parity with chat), or is it message-less (pure "surprise me")? Both defensible — decide during design, not now.

**Update 2026-06-09 (user)**: reconsider whether **weigh-in also deserves its own command** (e.g. `/character weighin`) rather than staying folded into `/character chat`. The 2026-05-29 direction was "keep weigh-in in chat," but weigh-in turns out to have genuinely _divergent context semantics_, not just a different arg shape: no invoking-user persona, no LTM read/write, and (after the epoch fix) **no STM-reset epoch cutoff** — it's a channel-scoped anonymous summon, not a personal chat turn. That semantic gap is itself an argument for a legible standalone command. Fold this into the same UX-restructure design pass; decide chat-vs-random-vs-weighin command topology together.

**Why inbox (not scheduled)**: explicitly NOT for beta.126; it's a UX-restructure with an unresolved design question, so it needs triage + a design pass before becoming a committed task. Touches `services/bot-client/src/commands/character/chat.ts` (mode branching), the slash-command definition, and `randomPick.ts`. Command-structure change → integration snapshots need updating (`pnpm test:int`).

_Shipped 2026-06-14 (#1205): per-user daily cap on system-key free-vision fallback (`VisionFallbackQuota`, fail-open) — the fast-follow guard for the #1204 broad fallback._

### `[FEAT]` Make the vision system-fallback daily cap a runtime admin-settings knob

**Surfaced 2026-06-14** (user), tuning the #1205 guard. The per-user daily cap on system-key free-vision fallback (`VISION_SYSTEM_FALLBACK_DAILY_LIMIT`, currently a code constant = 100) should eventually be a runtime **admin-settings** config item so the owner can tune it without a code change + redeploy — the same way other admin settings are managed. Gemma is `$0`, so the cap is purely a shared-rate-limit-pool protector; the right value depends on observed traffic, which argues for runtime tunability.

**Action**: thread the limit through the admin-settings layer (DB-backed `adminSettings` + the gateway admin config surface + the bot-client admin UI if one exposes it), falling back to the `VISION_SYSTEM_FALLBACK_DAILY_LIMIT` constant as the default. `VisionFallbackQuota` already takes `dailyLimit` as a constructor param, so the wiring is "resolve the configured value and pass it in" rather than a logic change. **Start**: `services/ai-worker/src/services/VisionFallbackQuota.ts` (already param-driven); the `adminSettings` resolution path in ai-worker.

**Why inbox**: a real follow-up but not urgent — the constant default (100) is a sensible starting value; promote when the owner wants to tune it from observed traffic without a deploy.

### `[CHORE]` Convert `/settings preset list` + `/voice list` to `browse`

**Surfaced 2026-06-14** by `commands:audit`'s subcommand-naming check — two legacy `list` subcommands where `browse` (with a select menu) is the preferred convention per `.claude/rules/04-discord.md`. The tool's `list`-nudge is working as designed; these are the standing signals it leaves.

**Action**: convert each to the `browse` pattern (select-menu pagination via the shared `utils/browse/*` helpers). Command-structure change → `pnpm test:int` snapshot update + manifest regen. Clears 2 of the 4 remaining `commands:audit` warnings. **Why a CHORE (not urgent)**: warn-level, UX-polish; the two `list` commands work fine as-is.

> **Triage of the original 13 `commands:audit` warnings is complete** (closed by #1210; preset/config rename shipped in #1211 → now 3 standing warnings): 1 tool false-positive fixed (stub regex), 6 deliberate verbs whitelisted, preset/config drift renamed, leaving the `list`→`browse` entry above plus the accepted `type` int/string drift (`admin presence` vs `deny add` — unrelated concepts, no action).
