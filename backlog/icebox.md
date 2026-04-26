## 🧊 Icebox

_Ideas for later. Resist the shiny object._

### Surfaced 2026-04-25 (beta.106 hotfix)

- 🌐 `[CHORE]` **Upstream LangChain PR — recognize `message.reasoning` in chat completions converter** — `@langchain/openai` v1.4.4's `converters/completions.js:160` extracts only `message.reasoning_content` (DeepSeek's legacy field name). OpenRouter, vLLM (post RFC #27755), and OpenAI's own GPT-OSS guidance all use `message.reasoning` (no `_content` suffix). Multiple open issues track this gap: [langchain #32981](https://github.com/langchain-ai/langchain/issues/32981) (OpenRouter→ChatOpenAI specifically), [#34706](https://github.com/langchain-ai/langchain/issues/34706), [#35901](https://github.com/langchain-ai/langchain/issues/35901). Submit a PR to `langchain-ai/langchainjs` adding `message.reasoning` (and `delta.reasoning` for streaming) recognition alongside the existing `reasoning_content` extraction. **Why iceboxed**: ecosystem fix with slow turnaround; once landed it would make our `OpenRouterFetch` interceptor's response-mutation logic redundant, but we have a faster local solution via `includeRawResponse: true` (in flight). **Start**: `services/ai-worker/node_modules/@langchain/openai/dist/converters/completions.js:160` for the upstream pattern to mirror; PR target `libs/providers/langchain-openai/src/converters/completions.ts` in [langchainjs](https://github.com/langchain-ai/langchainjs). Surfaced 2026-04-25 during reasoning-extraction investigation.

- 🛡️ `[LIFT]` **Custom undici Dispatcher with `connect.lookup` for true DNS-rebinding closure** — `safeExternalFetch.assertResolvedHostnameIsPublic` runs `dns.promises.lookup({ all: true })` and validates every returned IP is public. Closes the IPv4-public/IPv6-private family-mismatch bypass, but a TOCTOU window remains: between our lookup and undici's own resolution at fetch time, the DNS record could change. Mitigation: wrap fetches with a custom undici `Agent` whose `connect.lookup` runs the same validation (or pins the connection to the validated IP). **Why iceboxed**: requires custom Dispatcher implementation, not a hotfix-shape change. Forensic logging exists in beta.106 (`External URL hostname resolved to public IP(s)` at debug level — kept low-volume per round-2 review feedback; redeploy with `LOG_LEVEL=debug` to enable for incident triage) and would show whether real-world traffic indicates exploitation pressure — promote if we see suspicious rapid-DNS-swap patterns. Reference: [`request-filtering-agent`](https://github.com/azu/request-filtering-agent) does this for Node's HTTP client; needs adaptation for undici. Council recommendation 2026-04-25.

- 🛡️ `[LIFT]` **Loosen AudioProcessor SSRF allowlist if audio embeds need to work** — `services/ai-worker/src/services/multimodal/AudioProcessor.ts:56` keeps the strict Discord-CDN allowlist via `validateAttachmentUrl`. Audio embeds are nearly nonexistent in Discord UX (audio is almost always a direct attachment from `cdn.discordapp.com`), so the symmetric external-fetch fix that beta.106 applied to images was deliberately scoped out. Revisit when: (a) users report audio embeds failing to transcribe (Reddit/Imgur audio in extended context, forwarded audio attachments with non-CDN URLs), or (b) the same image/audio code path needs to converge for symmetry reasons. **Fix shape**: same two-tier validation pattern from `DownloadAttachmentsStep.routeAttachmentUrl` — try `validateAttachmentUrl` first, fall back to `validateExternalImageUrl` + a new `fetchExternalAudioBytes` (or generalize `fetchExternalImageBytes` with a content-type-prefix parameter). **Why iceboxed**: no current user complaints, additional surface area, council confirmed scope cut. Surfaced 2026-04-25 during beta.106 hotfix design.

- 🧹 `[CHORE]` **Pre-filter non-image embed URLs in `embedImageExtractor`** — Discord embeds carry a long-tail of non-image things (Tenor view-page URLs, Spotify/YouTube link cards, custom-emoji URLs, sticker references) that today flow through to ai-worker as "image attachments" and either fail validation or fetch text/HTML payloads (now caught by the Content-Type assertion in `safeExternalFetch`). A bot-client-side filter would reduce noise in ai-worker logs and avoid unnecessary external fetches. **Fix shape**: add an extension/path heuristic (`.png|.jpg|.jpeg|.gif|.webp|.bmp` or known image hosts) before pushing into the attachment list. **Why iceboxed**: the new external-fetch path now handles these gracefully (rejected via Content-Type assertion); this is a tidiness improvement, not a correctness fix. Surfaced 2026-04-25 during beta.106 hotfix audit.

- 🧹 `[CHORE]` **Typed `AllowlistRejectionError` for `validateAttachmentUrl`** — `DownloadAttachmentsStep.routeAttachmentUrl` matches the Discord-CDN allowlist failure by error-message substring (`message.includes('must be from Discord CDN')`). A typed error class would let the caller match by `instanceof` instead, which is more refactor-resilient. **Fix shape**: introduce `AllowlistRejectionError extends Error` in `attachmentFetch.ts`, throw it instead of `new Error(...)` when the host check fails, update the routing helper to match by class. **Why iceboxed**: the string match works today and is tested. Promote if the error message ever needs to change (e.g. localization, additional hosts in the message) or if a third validation tier appears. Surfaced 2026-04-25 during beta.106 hotfix design.

- 🧹 `[CHORE]` **Factor `validateUrlBaseSecurity` from validateAttachmentUrl + validateExternalImageUrl** — Both functions duplicate ~25 lines of surface checks (https only, no credentials, no non-standard ports, no IP-as-hostname, ReDoS-safe trailing-dot normalization). The duplication is intentional for the hotfix (low-risk, no refactor of the existing tested function), but a shared `validateUrlBaseSecurity` helper would prevent drift. **Fix shape**: extract the common checks into a helper that returns the parsed URL object; both validators compose it and add their distinct allowlist (or no-allowlist) logic on top. **Why iceboxed**: the duplication is small, both functions are tested independently, the refactor would touch hot SSRF code right after a production incident. Surfaced 2026-04-25 during beta.106 hotfix design.

- 🧹 `[CHORE]` **Per-step `errorInfo.type/shouldRetry` classification in `LLMGenerationHandler` catch** — Today's hotfix (PR #893) maps every non-DownloadAttachments step failure to `ApiErrorType.PERMANENT` + `shouldRetry: false`. Real-world step failures vary: `ConfigStep` and `AuthStep` can throw on transient DB/network issues that would benefit from `TRANSIENT`/`shouldRetry: true`; `NormalizationStep`/`DependencyStep`/`ContextStep` are usually permanent (data-derivation bugs). Today the practical user impact is minimal — the bot doesn't re-enqueue pipeline-step failures regardless of `shouldRetry`, so the misclassification is just slightly-misleading spoiler text. **Promote when**: a retry harness for non-Generation step failures gets wired (so `shouldRetry` actually drives behavior), OR users start reporting "PERMANENT" surfacing for what was clearly a transient hiccup. **Fix shape**: replace the binary `if (DownloadAttachments) … else …` with a Map<stepName, { category, type, shouldRetry }>. Surfaced 2026-04-25 by claude-bot review on PR #893 (medium severity).

### Surfaced 2026-04-24

- 🐛 `[FIX]` **GLM-family meta-preamble pattern drift** — GLM-4.5-Air and GLM-4.7 each shipped distinct preamble tag vocabularies (`<from_id>/<user>/<message>` for 4.5-Air, `<user>/<character>/<analysis>` for 4.7). Each revision needs its own extractor added to Pass 1 of `services/ai-worker/src/utils/thinkingExtraction.ts`. **Watch-item, not actionable yet**: when new GLM revisions deploy, monitor production logs for the existing `Stripped leading meta-preamble scaffolding` log lines NOT firing on reasoning-enabled responses where output looks structured. A new vocabulary will surface as unexplained user complaints ("why is my response starting with weird XML?") and absent log lines. Promotes to 🚨 Production Issues on first observed drift. Reference: PR #888 (GLM-4.7), PR #875 (GLM-4.5-Air), auto-memory `project_glm_47_quirks.md`. Surfaced 2026-04-24 by PR #888 review.

- 🐛 `[FIX]` **GLM-4.7 bare-`<analysis>` false-positive surface** — The `GLM_47_META_PREAMBLE_PATTERN` uses `{0,2}` on the preamble group, meaning it fires on a bare `<analysis>...</analysis>` block at the start of a response even with no `<user>`/`<character>` preamble. Intentional per observed production shape, but creates a false-positive surface: a personality explicitly instructed to begin responses with an `<analysis>` block (medical/research persona, structured-output format, diagnostic persona) would have its `<analysis>` content silently stripped from `visibleContent`. **Signal to watch for**: user reports of disappeared/truncated structured-output responses from personas with `<analysis>`-formatted instructions. **Mitigation on first observation**: tighten `{0,2}` → `{1,2}` in `thinkingExtraction.ts:~180`, removing the "handles bare `<analysis>` with no preamble tags" test case. Zero production evidence today of legitimate bare-`<analysis>` responses; also zero evidence of GLM-4.7 omitting _both_ preamble tags — so the tighten would cost nothing today but shrink the attack surface. Deferring until we see a real signal either direction. Reference: PR #888 round 4 review. Surfaced 2026-04-24.

- 🐛 `[FIX]` **Aggregate payload cap doesn't fire when any download fails (partial-failure observability gap)** — `DownloadAttachmentsStep.process` checks `allFailures.length > 0` before the aggregate-size check, so if any per-attachment download fails, the job throws a generic `Error('Failed to download...')` instead of `JobPayloadTooLargeError`. The job still fails correctly — it just doesn't surface the _additional_ fact that the surviving attachments would also have exceeded the 50 MiB aggregate cap. Minor observability gap: dashboards can't see "would have been too large anyway" as a separate failure signal. **Fix shape**: move the aggregate-size sum to a pre-flight check (sum the per-attachment `size` fields BEFORE downloading any bytes — Discord's API gives us sizes upfront in `AttachmentMetadata.size`), so the cap can fire as a classified pre-flight rejection independent of download success. **Why iceboxed**: today's failure mode is correct (job fails); this would only add diagnostic clarity. Promote if `JobPayloadTooLargeError` ever needs to drive a different retry policy than generic download failures, or if we add a UI surface that distinguishes "too large" from "couldn't fetch." Surfaced 2026-04-24 by PR #890 R4 claude-review.

- 🏗️ `[LIFT]` **Stronger structural guard: `sentinelSafe` field on typed-options schema** — Companion to PR #885 (autocomplete sentinel guards, shipped 2026-04-24). That PR protects all 19 known consumer sites with inline `isAutocompleteErrorSentinel(x)` early-returns. Works, but every new autocomplete-backed command is another place to forget the guard. The structural fix lives one layer down, in the typed-options accessor (`packages/common-types/src/utils/typedOptions.ts` + generated `packages/common-types/src/generated/commandOptions.ts`): add a `sentinelSafe: true` field on autocomplete-backed option schemas so the generated accessor itself throws a typed `AutocompleteSentinelError` when the sentinel is read. Each consumer then catches (or lets a top-level handler in `CommandHandler` catch) and renders the standard "Autocomplete was unavailable" reply — the guard becomes impossible to forget. **Why not bundled into PR #885**: would have expanded the quick-win scope into (a) generator changes for `commandOptions.ts`, (b) new error type + catch conventions, (c) removing the 19 inline guards in favor of the centralized one, (d) deciding how `CommandHandler` / modal-context handlers catch and reply. Each of those is its own design call. **Start**: `packages/common-types/src/utils/typedOptions.ts` (schema type + accessor switch); `packages/tooling/src/*/generate-command-types*` (wherever `commandOptions.ts` is generated from); `services/bot-client/src/CommandHandler.ts` for the catch-and-reply boundary. **Exit criterion**: all 19 inline sentinel guards from PR #885 deleted; adding a new autocomplete-backed command cannot silently skip the guard.

### Triaged from Inbox 2026-04-24

- 🏗️ `[LIFT]` **CI test-suite speed investigation** — CI runs spend ~4–5 minutes on the `test` step alone, and local pre-push hook runs ~4 minutes on Steam Deck (concurrency=1). The waiting cost compounds over every PR iteration and every Round-N review cycle. Investigate where the time actually goes before prescribing fixes. **Candidate areas, in priority order**: (1) Real-timer audits — grep `setTimeout|setInterval` in `*.test.ts` without nearby `vi.useFakeTimers()` or `vi.advanceTimers`. Observed 2026-04-24: `AudioProcessor.test.ts` has retry tests showing 3005ms / 3004ms duration lines (real 3s backoffs × several tests = ~12s pure wall-clock burn). Similar patterns likely elsewhere. (2) Test import cost — ai-worker suite's vitest stats showed 63s of `import` time on 2616 tests. Lazy-loading or narrower describes for heavyweight modules (Prisma, LangChain, sharp) could cut it materially. (3) CI concurrency — the pre-push hook sets `--concurrency=1` under `LOW_RESOURCE_MODE` for Steam Deck memory; if the GitHub Actions `test` step inherits the same flag, that leaves parallelism on the floor (runners have more memory than the Deck). **First step when picked up**: run `pnpm ops xray` or equivalent instrumentation to get per-file duration + import time, prioritize fixes by elapsed-seconds-saved-per-run. **Fix shape likely**: `DownloadAttachmentsStep.test.ts` pattern from PR #889 — injectable timing params default to prod values, tests pass `0` (dropped 540ms → 17ms there). Replicating across the ~5 slowest test files could meaningfully cut CI time. **Why iceboxed**: multi-step investigation+fix cycle (4-8 hours), no urgency today — CI passes, just slow. Promote when waiting on CI starts blocking iteration speed in a way the user notices session-to-session. Surfaced 2026-04-24.

### Triaged from Inbox 2026-04-22

_Second backlog-shrink pass. Same preservation principle — full prose retained._

- 🧹 `[CHORE]` **File OpenRouter issue for GLM-4.5-air fake-user-message reasoning leak** — Companion to PR #875 (shipped 2026-04-22). The Chain-of-Extractors post-processor is our fix, but OpenRouter's reasoning-middleware can polyfill this at the API layer so every consumer benefits. They actively polyfill similar quirks for DeepSeek/Qwen/Llama. **Payload**: attach raw API response from req `b533e288-fb07-46c0-a5e2-a0f78883e63e`, model string `z-ai/glm-4.5-air:free`, trigger `reasoning.enabled=true`. Note the pattern: model wraps CoT in `<from_id>UUID</from_id>\n<user>Name</user>\n<message>reasoning</message>` — structurally distinct from `<think>` but unambiguously a reasoning leak (UUID validation makes it safe to detect). **Exit criterion**: OpenRouter populates `message.reasoning` for this pattern → `GLM_FAKE_USER_MESSAGE_ECHO_PATTERN` and its test suite can be deleted. **Why iceboxed 2026-04-22**: user has not filed an upstream GitHub issue before; nervous about the first filing. Pickup path: either user gains comfort with the process, or a future session assistant drafts the issue text for review before submission (deliberately offered, user chose to defer entirely for now).

- 🐛 `[FIX]` **Character `Open Editor` can still blow the 3-second window on cold cache + slow gateway** — The two-click Edit-with-Truncation flow (PR #825 option b) materially narrowed but did not fully eliminate the 3-second risk. `handleOpenEditorButton` in `services/bot-client/src/commands/character/truncationWarning.ts` still calls `resolveCharacterSectionContext` before `interaction.showModal` — because Discord requires `showModal` to be the first response to an interaction, we can't `deferReply` before the resolve. In the common case the session is hot from step 1's warm and this is a sub-ms Redis hit. But a cold-cache fallthrough (Redis eviction, pod cold start, TTL past the step-1 warm window) routes through the gateway's `fetchCharacter`, which can take hundreds of ms to multi-seconds under load. When that blows the window, the handler's 10062 catch surfaces a visible retry message — not silent, but the user is already one click deep into a consent flow and the retry ask is confusing. Surfaced by PR #825 R8 (2026-04-17).

  **Why tracked now (low priority)**: the 10062 fallback is user-actionable (clicks "Open Editor" again, fresh 3-sec window, very likely succeeds on second try), so the bug is not silent. But the retry UX could be improved.

  **Fix options** (none urgent):
  - **(a)** Pre-resolve the full `CharacterSectionContext` during step 1's warm and stash it in an in-memory cache keyed by the `open_editor` button's customId. Step 2 retrieves synchronously, builds modal, `showModal` with zero async work. Works for single-replica bot-client; breaks on multi-replica unless the cache is Redis-backed (which reintroduces the async). Tzurot is currently single-replica for bot-client (Discord gateway requirement).
  - **(b)** Pre-build the modal (not just the context) during step 1 and stash the modal JSON. Same trade-offs as (a).
  - **(c)** Just raise the gateway timeout on `fetchCharacter` when called from the session-helpers path so the cold-cache fetch reliably fits in 3 sec. Smallest change but doesn't defend against the raw Redis latency spike.
  - Do nothing: the 10062 retry path is user-actionable. Accept the residual and rely on the warn log for frequency monitoring.

  **Start**: `services/bot-client/src/commands/character/truncationWarning.ts` `handleOpenEditorButton`; the 10062 catch immediately after `await interaction.showModal(modal)`; the step-1 warm origin in `handleEditTruncatedButton`; `services/bot-client/src/utils/dashboard/sessionHelpers.ts` `fetchOrCreateSession`. Demoted from Inbox 2026-04-22 — self-described low priority, user-actionable fallback exists.

- 🐛 `[FIX]` **Stale "Open Editor" button after step-1 session-warm failure in character truncation flow** — Sibling to the 3-sec residual entry above. When `handleEditTruncatedButton`'s session warm fails (character-deleted race between warning display and opt-in click), the handler already sent `interaction.update` with the "Ready to edit" embed + Open Editor button; `loadCharacterSectionData` then sent a followUp error; but the Open Editor button is still visible. If the user clicks it, `resolveCharacterSectionContext` fails again and sends a second redundant followUp. User sees two back-to-back "Character not found" messages with a stale button between them. Flagged by PR #825 R10 (2026-04-17).

  **Not a data-safety issue**: the second failure is just UX noise. The user can close the warning and re-open the dashboard; no data is lost or corrupted.

  **Fix options**:
  - **(a)** On warm-null return, send a **second** `interaction.editMessage` to disable the Open Editor button (set `.setDisabled(true)`) so clicking it is impossible. Cleanest UX; requires tracking the original message id since the interaction is acked.
  - **(b)** On warm-null return, replace the "Ready to edit" embed entirely with the error state via `interaction.editReply` (in place of the followUp). Removes the stale button by replacing its container. UX is clearer (one message, one state) but requires rework of the `loadCharacterSectionData` error-reply path since it currently sends a followUp, not an editReply.
  - **(c)** Accept the double-error UX. The underlying state (character deleted) is rare enough that the edge case doesn't warrant the complexity. Log-only fix + documentation comment.

  Option (c) is what the code currently does. (a) or (b) are the UX improvements.

  **Start**: `services/bot-client/src/commands/character/truncationWarning.ts` `handleEditTruncatedButton` — the `if (warmResult === null)` block; `services/bot-client/src/commands/character/sectionContext.ts` `replyError` + `loadCharacterSectionData`. Demoted from Inbox 2026-04-22 — self-described UX noise, not data-safety.

- ✨ `[FEAT]` **Migrate Nyx persona from global CLAUDE.md to a user-level custom output style** — Nyx (the personality/tone/communication-rules block) currently lives in `~/.claude/CLAUDE.md` Universal Preferences. This works but couples persona with instruction-set content (safety rules, keybindings, Steam Deck env). Claude Code now supports custom output styles (see https://code.claude.com/docs/en/output-styles) — persona could move to a dedicated `~/.claude/output-styles/nyx.md` (or similar), leaving CLAUDE.md for mechanical prefs and safety constraints only. **Requirements**: (a) do NOT lose the "Explanatory" style's Insights-box format — user explicitly values that; the new style should merge Nyx persona + Explanatory format; (b) research what's actually customizable in output styles (full prompt override? delta layer?); (c) verify that the style activates automatically across all sessions (not per-project) since Nyx is a cross-project persona; (d) determine whether merging two styles (Nyx + Explanatory) is supported or if we need to fork Explanatory's template and add Nyx to the fork. **Investigation steps**: (1) fetch and read https://code.claude.com/docs/en/output-styles end-to-end; (2) inspect `~/.claude/output-styles/` (if exists) for existing style definitions; (3) inspect built-in styles for the Explanatory definition as a template; (4) pilot as `nyx.md` in a throwaway project before promoting to user-level default. **Start**: WebFetch the output-styles doc; `ls ~/.claude/output-styles/ 2>/dev/null` to see if the directory exists. Surfaced 2026-04-22. Demoted from Inbox — quality-of-life, no urgency, research-heavy.

- 🧹 `[CHORE]` **Investigate bot-client Pino log-level `info`-vs-`warn` drift** — While diagnosing the voice-engine over-size bug on 2026-04-19, the incident log entry `TTS audio exceeds Discord file size limit, skipping attachment` appeared as `level: "info"` in the Railway JSON stream even though `services/bot-client/src/services/DiscordResponseSender.ts:264` emits it via `logger.warn(...)`. Either Pino's numeric-level config is being flattened to `info` somewhere in the bot-client transport pipeline, or Railway's display layer is relabelling. Makes `railway logs --filter '@level:warn'` and similar severity-based filters unreliable across services. Verified 2026-04-22: `packages/common-types/src/utils/logger.ts:264-279` has no `formatters.level` override, so Pino's default emits numeric `40` for warn. The drift is happening downstream (Railway's mapping numeric → string incorrectly, or a transport in between). Not fixed by the PR #866 Pino-rules sweep. **Fix shape**: (a) pick a known `logger.warn` callsite in bot-client; capture a real emitted log from prod via `railway logs --json`; (b) compare the `level` field value to what Pino should emit per its level map (`warn = 40`); (c) trace the logger bootstrap + any Railway-side forwarding. **Start**: `services/bot-client/src/services/DiscordResponseSender.ts:264` (known warn call) + `packages/common-types/src/utils/logger.ts` factory. Cross-check against ai-worker logs — those DID emit `level: "info"` / `level: "error"` correctly in the same incident window, so the drift may be bot-client-specific. Surfaced 2026-04-19. Demoted from Inbox 2026-04-22 — observability gap, not actively blocking incident response.

### Triaged from Inbox 2026-04-21

_Items moved from Inbox during backlog-shrink pass. Full prose preserved — implementation detail, start-file pointers, and reasoning stay accessible for when a session picks any of these up._

- 🧹 `[CHORE]` **`detail.ts` silent-fail risk if imported in isolation post-PR-#856 refactor** — PR #856 moved the `registerBrowseRebuilder('deny', …)` call out of `browse.ts` into a dedicated `browseRebuilder.ts` that's imported by `deny/index.ts` at startup. Today's entry points (command loader → `index.ts`) all transitively load `browseRebuilder.ts` before any detail handler fires, so the rebuilder is always registered when needed. Residual risk (flagged by claude-bot review on PR #856 but intentionally not blocked): if a future test or code path imports `deny/detail.ts` directly without also loading `deny/index.ts` or `deny/browseRebuilder.ts`, the back-button / post-action rebuild path would silently fail to find a registered rebuilder — the symptom would be a "no rebuilder registered for 'deny'" log (or whatever the registry's miss-behavior is) and the user seeing a stale screen. **Fix shape**: either (a) add a defensive `import './browseRebuilder.js';` side-effect back into `detail.ts` (tradeoff: reintroduces the edge depcruise flagged, so only meaningful if we also teach depcruise to ignore side-effect-only imports, probably not worth it); (b) add a lightweight runtime assertion in the rebuilder-consuming code path (e.g. inside `handleSharedBackButton`) that logs an error if no `'deny'` rebuilder is registered — catches the failure mode without coupling detail.ts to the rebuilder module; (c) write an explicit integration test for the `detail.ts`-only import scenario that asserts the back-button fails cleanly (not silently). Option (b) is cheapest and most broadly useful (protects all four browse-capable commands, not just deny). Not urgent — single entry point today makes this theoretical. **Start**: `services/bot-client/src/utils/dashboard/sharedBackButtonHandler.ts` (or wherever the rebuilder registry is consumed); `services/bot-client/src/commands/deny/browseRebuilder.ts` for the registration-point JSDoc that already calls out this pattern.

- 🧹 `[CHORE]` **Periodic 8-point cleanup-sweep skill** — Inspired by a Shaw tweet (2026-04-20) prescribing an 8-subagent cleanup pass over a codebase: deduplicate/DRY, consolidate types, prune unused code (knip), untangle circular deps, remove weak types (`unknown`/`any`), remove defensive try/catch without purpose, remove deprecated/legacy/fallback code, strip AI-slop comments. We already enforce all 8 concerns **continuously** via CI (CPD, `common-types`, knip, depcruise, `strict: true`, 00-critical rules on error handling and "no backward compatibility", CLAUDE.md comment rules). Continuous enforcement is better for steady state — but it doesn't catch _accumulated drift_ that squeaks past linters (e.g., in-motion narration comments that no linter flags). **Fix shape**: add a `/tzurot-cleanup-sweep` skill under `.claude/skills/` that fans out parallel `Agent` invocations — one per concern — with a "report + implement high-confidence items only" contract. Runs quarterly or between epics as an audit. Keep continuous enforcement in CI; the skill is the explicit periodic deep-clean. **Deliberate divergence from Shaw's prescription**: we DO treat `unknown` as correct at system boundaries when paired with Zod — the skill's "weak types" agent should flag only `unknown` inside internal logic, not at boundary layers. **Start**: `.claude/skills/tzurot-arch-audit/` is the existing audit skill — use as the structural template; differ in that this one fans out to sub-agents and implements fixes rather than only reporting. Surfaced 2026-04-21 via Shaw tweet (@shawmakesmagic).

- 🧹 `[CHORE]` **AI-slop comment explicit hunt — periodic sweep** — Narrative-slop comments like `// Previously this did X`, `// Now updated to Y`, `// As part of PR #123`, `// Refactored from the old version`, or `// TODO(claude)` accumulate invisibly — no linter catches them, and CLAUDE.md's "no in-motion narration" rule depends on author discipline. A grep-based sweep every few releases is low-cost. **Fix shape**: a repo-wide grep for patterns like `// (Previously|Now|Formerly|Refactored|Updated|Changed|As part of|Per PR|Moved from|Extracted from)`, plus `// TODO(claude)` and bare `// AI:` markers. Report hits, hand-review each (some may be legitimate "why" comments that just use the trigger phrases), remove or rewrite the rest. Could live inside the cleanup-sweep skill above (entry #8), or as its own standalone skill/script. Possibly folds into a periodic `pnpm ops xray --comments-audit` subcommand. **First sweep done 2026-04-20** (commit `ca24d6f48`): size was ~24 hits across 19 files, of which 8 were genuine narrative-slop and got rewritten/removed; the rest were legitimate "why" comments using trigger words. Tell that worked: if removing the comment leaves a reader worse off, it earned its place. **Next sweep**: re-run after each release; expect single-digit new accumulations. Surfaced 2026-04-21 via Shaw tweet comparison.

- ✨ `[FEAT]` **Bring back v2 `/cleandm` command for removing bot-authored clutter from DM history** — v2 had a `cleandm` command that let users clear bot-posted non-conversation messages from their DM so the channel kept just the actual personality conversations. v3 regressed on this: verification prompts, help messages, error replies, and slash-command error responses accumulate in the DM and clutter the scroll-back. **Fix shape**: new DM-only slash command `/cleandm [scope:recent|all]` that (a) fetches the bot's own messages in the current DM channel (bots can only delete their own messages), (b) filters out any that match the personality-reply prefix `DM_PERSONALITY_PREFIX_REGEX = /^\*\*(.+?):\*\*/` from `DMSessionProcessor.ts`, (c) bulk-deletes the remainder respecting Discord's DM rate limit (~5 deletes/sec). **Architectural fit**: reuse the existing `DM_PERSONALITY_PREFIX_REGEX` as the "is this conversational?" classifier — it's already the rule `DMSessionProcessor` uses to decide session membership, so cleanup logic tracks any future prefix changes for free. **Scope options**: `recent` = last ~100 messages (fast, bounded); `all` = full-history sweep with progress updates and chunked deletion. Default to `recent`. **Start**: new command at `services/bot-client/src/commands/dm/cleandm.ts`. Add `.setContexts(DM)` + `.setIntegrationTypes(UserInstall)` on the SlashCommandBuilder so the command only surfaces in DMs. Surfaced 2026-04-20 during DM-broken investigation.

- 🧹 `[CHORE]` **Narrow the PostToolUse-hook payload jq paths after observational data arrives** — `.claude/hooks/pr-monitor-reminder.sh` currently tries three jq paths to extract `gh pr create` stdout (`.tool_result.stdout // .tool_response.output // .output // empty`) because Claude Code's PostToolUse payload shape isn't strictly documented. A stderr line fires on parse miss so drift is detectable. **Revisit after 3–5 PRs land via the hook**: if the stderr line never fires, the three paths are dead code — narrow to the single path the payload actually uses. If it fires every time, stdout parsing is dead weight and the `gh pr list --head` fallback is the only real code path — drop the parse entirely. Either way, remove the guesswork once data exists. **Start**: check `journalctl` / terminal history for `pr-monitor-reminder: no tool_result stdout available` lines across the next few PR cycles. Surfaced 2026-04-19 during PR #837 r5 review.

- 🧊 `[ICEBOX]` **UUIDv7 audit for other deterministic-UUID-from-mutable-input tables** — 2026-04-19 LlmConfig fix applied the same pattern Phase 5 personas used: random-UUID PK + `@@unique([ownerId, name])`. Other deterministic-UUID generators in `packages/common-types/src/utils/deterministicUuid.ts` should be audited: are they keyed off mutable user inputs, or off stable identifiers (Discord IDs, slugs)? **Candidates for same treatment**: `generateSystemPromptUuid(name)` — name is user-editable; any rename-then-recreate scenario could hit the same phantom collision. **Likely fine as-is**: `generateUserUuid(discordId)`, `generatePersonalityUuid(slug)` (slug is immutable/assigned), `generatePersonaUuid` (Phase 5 fixed this one). Audit-first, action-second. **Start**: enumerate each `generate*Uuid` in `deterministicUuid.ts`, cross-reference against the entity's schema to check if the seed source is mutable. Surfaced 2026-04-19.

- 🏗️ `[LIFT]` **Audit LLM response max-length to cap TTS-audio size at a defensible ceiling** — Post-Opus transcode, 64 kbps Opus keeps ~17 min of speech under Discord's 8 MiB attachment limit. The `voice_omitted_too_long.txt` fallback in `DiscordResponseSender.fetchTTSFiles` handles the residual, but if an LLM ever produces a response long enough to exceed 17 min of speech, the upstream problem (unbounded response length) is worse than the TTS drop — users would see a 17+ min audio attempt fail, and the same text would likely also be chunked across many Discord messages. No explicit max-response-length is enforced today. **Fix shape**: audit the generation pipeline's max-token configs in `services/ai-worker/src/services/` (probably `ConversationalRAGService` or model-config cascade); consider whether to cap response length at ~3000 chars (≈3 min of speech, comfortably under any ceiling). If implemented, the fallback attachment becomes structurally unreachable for the primary path and can be reduced to pure defense-in-depth. **Speculative — wait for residual data**: may never fire in practice if most responses stay under 2000 chars already. The `voice_omitted_too_long.txt` log frequency over the first week post-deploy is the empirical input for whether this audit is needed. Surfaced 2026-04-19 during voice-engine over-size fix.

- ✨ `[FEAT]` **Investigate Discord user-app integration capabilities** — Tzurot is currently installed as a server-scoped bot. Discord also supports "user app" installations where the bot is scoped to the user and can be invoked anywhere (including servers where the bot isn't installed, DMs, and group DMs). Slash commands already partially work in this form (noticed they can be used in other servers). Investigate: what else does user-app scope unlock? Could it make the bot semi-usable in group DMs? Could it improve 1:1 DM UX? What are the limitations (rate limits, permissions, webhook availability)? Low priority — scoping/scouting only until higher-priority work lands. **Start**: read Discord developer docs on user-install apps, compare feature matrix to our current server-install feature set, identify any UX gains specific to Tzurot's personality-chat model.

- 🐛 `[FIX]` **AI occasionally hallucinating response footer, causing duplication** — Rarely, models (observed with `z-ai/glm-4.5-air:free`) hallucinate the "Model: ... / FREE Using free model" footer text into their response content, which then gets the real footer appended on top — resulting in doubled footer lines. Very rare but user-visible. Investigate whether post-processing already strips known footer patterns; if not, add a cleanup step in `ResponsePostProcessor` or the response sender that detects and removes hallucinated footer content before the real footer is appended. Related: the LLM duplicate/looping response detection item may share post-processing infrastructure. **Start**: grep for footer-appending logic (likely in bot-client response sender or ai-worker post-processor), check if any existing stripping handles this pattern.

- 🐛 `[FIX]` **LLM duplicate/looping response detection** — GLM-5 observed producing responses with repeated content blocks (same paragraphs appearing twice within one message). Post-processing should detect and deduplicate repeated paragraph-level blocks. Observed 2026-04-05 with `z-ai/glm-5`. **Start**: `services/ai-worker/src/services/ResponsePostProcessor.ts` — add a deduplication step; `services/ai-worker/src/utils/responseArtifacts.ts` — may fit alongside existing cleanup patterns.

- 🏗️ `[LIFT]` **Rate limit `/voice-references/:slug`** — Unauthenticated endpoint serving binary audio from DB. Low urgency (Railway private networking limits exposure).

- 🏗️ `[LIFT]` **Dynamic free model selection from OpenRouter** — Replace hardcoded `FREE_MODELS` / `VISION_FALLBACK_FREE` with a query layer on `OpenRouterModelCache`. Models go stale when sunset. **Start**: `services/api-gateway/src/services/OpenRouterModelCache.ts`.

<!-- "Inspect command privacy toggle" entry superseded 2026-04-25 by the Inspect UX Hardening mini-epic in Current Focus, which implements default-on redaction for non-owners (no per-personality toggle needed). -->

- ✨ `[FEAT]` **Character import — optional voice file support** — Accept optional voice reference audio alongside character data import.

- 🏗️ `[LIFT]` **Standardize over-long field handling pattern across commands (rule-of-three watch)** — Two consumers now have the two-flow pattern (detection + destructive-action warning + explicit opt-in; "View Full" for reads): `/memory` via `detailModals.ts:61-156` and `/character` via `truncationWarning.ts` (shipped in PR #825 / beta.100). The pattern is duplicated, not shared. Per rule-of-three, the third consumer triggers extraction into a shared utility `services/bot-client/src/utils/dashboard/overLongFieldWarning.ts`. Likely third-consumer candidates: personas with long `content`, presets with long `systemPrompt`. **Action**: (1) Audit persona and preset edit flows for silent `slice(0, maxLength)` truncation sites — grep `services/bot-client/src/commands/{persona,preset}/` for `slice` and `setValue`. (2) When the audit surfaces a real data-loss case, fix it AND extract the shared utility in the same PR (migrate memory + character + new-consumer to the shared module). (3) If no third consumer surfaces naturally, leave as-is — the duplication cost is bounded and the two implementations are small. **Start**: `services/bot-client/src/commands/memory/detailModals.ts:61-156` (memory impl), `services/bot-client/src/commands/character/truncationWarning.ts` (character impl), `services/bot-client/src/commands/{persona,preset}/` for audit targets.

- 🧹 `[CHORE]` **Periodic audit of `scripts/` for patterns to promote to `packages/tooling/`** — `scripts/` is documented as a home for one-off data migration / codegen / investigation scripts that run once and are deleted. But over time the category accretes permanent-ish files (current subdirectories: `analysis/`, `data/`, `debug/`, `deployment/`, `migrations/`, `testing/`, `src/db/`, etc.) that suggest some "one-offs" actually repeat. When a pattern has 3+ sibling scripts, it's graduated past "one-off" and should become a `pnpm ops` command with structured options, tests, and doc. Audit rule: when adding a new `scripts/` file, check `scripts/` for sibling files with similar shape; if 3+ exist, promote. Schedule a quarterly audit to catch accreted patterns. **Start**: `find scripts/ -name '*.ts'` to enumerate, group by shape, identify 3+ sibling clusters as promotion candidates.

- ✨ `[FEAT]` **Cross-channel context slice via message-link range** — Users want to import a specific slice of another channel's history into the current conversation by giving a start and end marker (message ID or message link), not just individual messages. Today the only reliable way to pull other-channel context is to paste a bunch of message links one-by-one and let the reference parser expand each — messy, tedious, and doesn't preserve ordering well for long ranges. Distinct from LLM-driven auto-retrieval path; this is explicitly user-driven bulk import of a known range. **Investigation (2026-04-13)**: infrastructure is ready, but there's a security prereq. Location is `services/bot-client/src/handlers/references/`. Clean Parser → Resolver → Formatter architecture. Strategy pattern already in place: `handlers/references/strategies/` has `ReplyReferenceStrategy` and `LinkReferenceStrategy`. A new `MessageRangeStrategy` plugs in as a sibling — no architectural refactor needed. Estimated ~100–150 LOC. **🔴 CRITICAL security finding — permission check is bot-only, not user-scoped**: `LinkExtractor.fetchMessageFromLink()` (lines 124-251) fetches via `sourceMessage.client` (the bot's own Discord credentials). It verifies the bot has access; it does NOT verify the invoking user has access to the source channel. This is already a live info-leak vector in single-link expansion. **A range-import feature would inherit and amplify this (1 link → N messages).** Fixing the permission check is a hard prerequisite for safely shipping range-import. **Start (when a session picks this up)**: fix `LinkExtractor.fetchMessageFromLink()` user-permission check first; then create `handlers/references/strategies/MessageRangeStrategy.ts` + `MessageRangeExtractor.ts`; plug into `ReferenceCrawler.ts`.

### v2 Parity (Low Priority)

_Eventually kill v2, but these are rarely used features._

- **Personality Aliases** - User-managed alternative names for personalities. v2 had: multi-word aliases (1-4 words, longest-match priority), smart collision handling (append name parts, then random suffix), auto-alias creation from display names, and alias reassignment between personalities. Single-level indirection only (alias → personality ID, no chains). v3 already has `PersonalityAlias` model in schema.
- **Rate Limiting** - Token bucket rate limiting
- **PluralKit Proxy Support** - Support PluralKit proxied messages

### Latent (relevant only if specific triggers fire)

#### 🐛 Near-duplicate consecutive replies on `glm-4.5-air:free` — observability primed, awaiting next incident

Diagnostic PR landed 2026-04-19 with full `CrossTurnDetection` logging (per-message `comparisonReport` with hash, 80-char prefix, Jaccard and bigram scores), race-window telemetry in `ContextStep`, and reasoning-mode engagement telemetry in `ResponsePostProcessor`. Latent now — no further action until the next user-reported occurrence gives us data to correlate.

**Ruled out (do not retry)**: request-hash cache busting (nonce in system prompt didn't help), temperature jitter (breaks this model's output quality), threshold adjustment (council math 2026-04-19 showed genuine near-duplicates would score ≥0.95 Jaccard, so prod's 0.72-0.78 band is baseline persona overlap, not almost-caught duplicates).

**Working hypothesis**: model-inference-level stickiness on the Z-AI provider side — not something we can prevent at the request layer.

**Runbook when user reports next duplicate**:

1. Get approximate UTC time, channel ID, personality, whether reasoning mode was requested.
2. `railway logs --service ai-worker --json | jq -c 'select(.name == "CrossTurnDetection")' | grep <jobId or time window>` — inspect `comparisonReport`.
3. Check for `[ContextStep] Race-window signal` warnings near that time. If present, DB write-read race is the cause.
4. Check `[ResponsePostProcessor] Reasoning mode requested but did NOT engage` — correlation with incidents tells us whether reasoning-mode reliability is part of the story.
5. If none explain it, model-inference-stickiness stands. Potential mitigations: swap models for specific users, add user-facing "regenerate" button, or accept residual given low frequency.

**Why Latent**: we've done the pre-work; the next move requires an incident to correlate against. Surfaced 2026-04-19.

#### ✨ Discord system-message handling (welcome/join events in activated channels)

Open question: when a user joins a guild where the bot is activated in the welcome channel, Discord emits `MESSAGE_CREATE` for the system-generated join message. Does the bot currently see these? Do they arrive as empty-content messages (and fall into whatever guard handles empty content), or as typed system messages with `message.system === true` and a known `MessageType` (`UserJoin`, `GuildBoost`, `ChannelPinnedMessage`, etc.)? If unhandled, the risk is (a) silent pass-through to AI with empty input, (b) duplicate responses, or (c) they're dropped entirely and we miss a UX opportunity for personality-aware welcomes.

**Investigation steps**:

1. Grep `MessageType.UserJoin`, `message.system`, `isSystem` across `services/bot-client/src/handlers/MessageHandler.ts` + `PersonalityMessageHandler.ts` — is there explicit handling today?
2. Test in a local guild by joining with a second account — observe what fires in ai-worker logs.
3. Inspect `message.content` for system messages (typically empty string with `message.system === true`, `message.type === MessageType.UserJoin`).

**Decision after investigation**: ignore explicitly (safest default, ship as guard), respond with personality-aware welcome (feature opportunity, opt-in per guild), or surface only when channel explicitly configured for welcomes.

**Why Latent**: no active user pain; `[FEAT]` investigation that only becomes relevant if a concrete welcome-UX use case appears. Surfaced 2026-04-21.

#### 🏗️ Singleton-hazard guard for `UserService` cache

Relevant only if `UserService` is ever refactored from per-request instantiation to a singleton (a reasonable perf improvement).

`UserService.getOrCreateUserShell` intentionally does NOT write to `this.userCache` to prevent a subtle bug: in a singleton context, a shell call would cache a `discordId → userId` mapping, causing subsequent `getOrCreateUser` calls to short-circuit out of the cache and skip `runMaintenanceTasks` (username upgrade + persona backfill). Today's per-request instantiation keeps the cache cold, so this is latent.

Hazard is documented in the cache field's JSDoc (`packages/common-types/src/services/UserService.ts`). Options if UserService is made a singleton: (a) split the caches so shell and full have separate tracking; (b) move username upgrade/persona backfill out of the hot-path into an explicit "ensure provisioned" method callers invoke. Flagged by PR #805 review.

#### 🐛 Voice engine (Pocket TTS) intermittent failures

_Superseded by TTS engine upgrade epic in Current Focus._ Pocket TTS is being replaced by Chatterbox Turbo (research done 2026-04-12, evaluation in progress). Any fix to Pocket TTS would be throwaway work once the replacement ships. Revisit only if the TTS epic stalls for multi-session reasons.

#### ✨ "Cough fallback" pre-recorded audio for TTS failure (RP immersion)

Even after the Opus transcode + `voice_omitted_too_long.txt` fallback (shipped 2026-04-19), an unrecoverable TTS failure still breaks roleplay fiction — the user sees a text attachment named "voice_omitted_too_long" instead of hearing the character. Council raised the idea (2026-04-19) of a pre-recorded 1-sec neutral audio clip (sigh, static, ambient breath) that plays when voice synth hits a terminal error. Maintains character immersion at the cost of mild ambiguity (user might not realize it's an error state).

**Fix shape**: pre-record a short (~1 sec, <50 KB) audio asset; wire it into `DiscordResponseSender.fetchTTSFiles` as a final fallback after the text-attachment branch; consider per-personality opt-in (some characters may want a specific voiced "sorry, couldn't speak" instead of generic ambient sound).

**Why Icebox**: pure polish. The `voice_omitted_too_long.txt` attachment already gives the user a visible signal that voice was attempted. The cough fallback is a UX upgrade, not a correctness fix. Revisit if users report the text-attachment signal feels jarring for specific personalities.

### Infrastructure Debt (Do Opportunistically)

#### 🏗️ Reasoning/Thinking Modernization

Partially done: migrated from `include_reasoning` to modern `reasoning` param via `modelKwargs`. But the custom fetch wrapper in `ModelFactory.ts` that intercepts raw OpenRouter HTTP responses and injects `<reasoning>` tags is still fragile — LangChain's Chat Completions converter silently drops `reasoning` fields, so we intercept before it parses. Needs a cleaner approach (e.g., native Responses API support from OpenRouter, or a LangChain plugin).

**Full details**: `~/.claude/plans/tender-tinkering-stonebraker.md` (Phase 4)

#### 🏗️ Prompt Caching (Anthropic)

Add `cache_control` breakpoints to static prompt sections (character profile, response protocol) for Anthropic models via OpenRouter. Deferred Phase 4 from the XML prompt restructure.

#### 🏗️ Streaming Responses

Stream LLM responses to Discord for better UX on long generations.

#### 🏗️ File Naming Convention Audit

Inconsistent casing between services. Low value / high effort.

#### 🏗️ Incognito Mode - Parallel API Calls

Status command fires up to 100 parallel API calls. Have API return names with sessions.

#### 🏗️ Platform Abstraction Layer — decouple UX from Discord

**Origin (stream of consciousness, 2026-04-13)**: what if there were a translation layer between _the user interactions I want_ and _what Discord slash commands actually look like_? Framed two ways:

1. **Portability hedge**: Discord may stop being a viable platform at some point, and we don't want to be caught flat-footed. A layer that encodes "what experience do I want users to have" separately from "how does Discord express that" would make retargeting to Stoat (née Revolt), a web UI, or any other arbitrary platform a matter of writing a new adapter rather than rewriting every command.
2. **Near-term DX**: a standardized DSL for building slash commands quickly and easily — on top of (and in the same spirit as) the ongoing CPD reduction / duplication cleanup. Instead of each command hand-rolling a `SlashCommandBuilder` tree + bespoke option parsing + bespoke handler wiring, a small in-house builder describes "a command with these options and this intent," and generators produce the Discord registration, the dispatch, and (eventually) any alternate-platform adapter.

**Why it's in Icebox and not deleted**: (a) the CPD reduction work (subcommand router consolidation, browse helpers, dashboard session/modal utilities) is already pushing toward this shape without anyone asking for it — if a DSL eventually crystallizes, it should crystallize the patterns the consolidation work has already validated, not invent new ones; (b) it's the right frame if/when Discord does become untenable, and having thought about it is cheaper than needing it without having thought about it.

**Revisit when**: (1) CPD is at a low baseline and the remaining command boilerplate visibly wants to be a builder function (`defineSlashCommand({ name, options, intent, onInvoke })`) rather than raw `SlashCommandBuilder` chains, or (2) a concrete portability requirement appears (Discord API change, new platform target, web UI project).

**Current state (2026-04-13 investigation)**: the codebase is already **~45–55% DSL-shaped**. `defineCommand()` at `services/bot-client/src/utils/defineCommand.ts:57-162` already serves as the DSL nucleus — it enforces command contracts, abstracts deferral modes (with context-type variance: `ModalCommandContext` vs `DeferredCommandContext` vs `SafeCommandContext`), and declares component routing via `componentPrefixes`. Shared utilities cover browse/dashboard/session/modal patterns comprehensively (see table in `.claude/rules/04-discord.md`). Empirical utility-call density: browse commands ~7% of LOC, dashboard commands ~13%.

**What `defineCommand` does NOT yet absorb** (the residual boilerplate a full DSL would need to cover): `SlashCommandBuilder` chain construction (e.g., `commands/character/index.ts:215-388` is 174 LOC of Discord.js tree), option parsing via per-command codegen helpers, subcommand routing via external factories (`createMixedModeSubcommandRouter`, `createTypedSubcommandRouter`), error-handling try-catch wrapping, and `ModalBuilder` / `TextInputBuilder` chains.

**What Phases 5–6 of the Active Epic would push further**: `requireDashboardSession` (~8 clones), dashboard modal/select handlers (~6 clones), subcommand router consolidation (~3 clones). After those land, ~35–50 LOC per command remains as essentially irreducible `SlashCommandBuilder` + `ModalBuilder` tree construction. That's Discord.js API surface and can't go into a utility without either (a) code generation, (b) a declarative schema compiler, or (c) a thinner-than-Discord.js DSL that accepts less API control.

**Framing insight**: a realistic DSL could eliminate 50–60% of per-command boilerplate; the remaining 40–50% IS the Discord.js API surface — which is also exactly what a cross-platform abstraction layer would need to replace. So the irreducible-boilerplate problem and the portability problem are the same problem viewed from two angles. This suggests the "revisit" trigger isn't really about CPD reaching zero — it's about whether the cost of a schema compiler or code generator is worth paying, which correlates with how seriously we're pursuing portability.

**User's own framing**: "Probably a bit pie in the sky, but I want to at least think about it."

### Code Quality

#### 🧹 Mock Convention Unification Audit

The codebase has two mock conventions side-by-side: `src/test/mocks/*.mock.ts` explicit-import libraries (~10 files in ai-worker + bot-client, pre-existing) and `src/services/__mocks__/AuthMiddleware.ts` vitest auto-discovery (1 file, added in PR #883). The split serves two real mechanisms — factory-libraries that can't be tied to a specific module path vs. module-replacement mocks that vitest auto-resolves — but nobody audited which existing `.mock.ts` files actually need explicit-import flexibility vs. which are single-module replacements that could migrate to `__mocks__/` for DRY.

**Scope**: ~10 files to audit, ~5-7 likely migrate, ~2-3 stay as factory libraries. ~2-3h.

- **Initial-skim candidates for migration**: `ai-worker/src/test/mocks/{LLMInvoker,PromptBuilder,ContextWindowManager,LongTermMemoryService,MemoryRetriever,ReferencedMessageFormatter,UserReferenceResolver}.mock.ts` + `bot-client/src/test/mocks/PersonalityService.mock.ts`.
- **Stay as-is**: `bot-client/src/test/mocks/Discord.mock.ts` + `ai-worker/src/test/mocks/utils.mock.ts` are factory libraries, not module replacements.

**Deliverables**: (a) per-file audit notes; (b) migrations for qualifying files; (c) caller updates (`vi.mock(path)` with no factory); (d) rule in `.claude/rules/02-code-standards.md` documenting "use `__mocks__/` for module replacement; use `.mock.ts` library for reusable factories not tied to a single module."

**Tried and rejected on PR #883**: explicit `vi.mock(path, () => import('./.mock.ts'))` pattern with an imported factory — fails with circular-mock reentry when the mock file uses `export *` AND with `ReferenceError: Cannot access '__vi_import_0__' before initialization` when the factory is an imported symbol (vitest hoists `vi.mock` above imports). `vi.hoisted()` workaround reconstructs per-file boilerplate. The `__mocks__/` auto-discovery is vitest's purpose-built escape hatch for the same-package DRY case.

Surfaced 2026-04-23.

#### 🏗️ Unify Shapes Job Error Handlers

`handleExportError` (ShapesExportJob.ts) and `handleImportError` (ShapesImportJob.ts) are near-identical: `willRetry` computation, three-way log message, re-throw or mark DB as failed. Extract to a shared helper in `shapesCredentials.ts` or a new `shapesJobHelpers.ts`.

#### 🧹 Audit Existing Tests for Type Violations

Review all `*.test.ts` files to ensure they match their naming convention.

### Low-Priority Audits

- **Audit API Routes for Zod Validation** — Several routes use manual `typeof` + `isValidDiscordId()` instead of Zod schemas at boundaries. Large scope, no recent production impact. Discovered PR #688.
- **DB-Sync Deletion Propagation** — Cross-env sync only upserts, so prod deletions get undone on re-sync. Workaround: manual cleanup. Needs design decision (tombstones, deletion log, sync manifest). Low urgency.

### Nice-to-Have Features

- **Release Notifications** - `/changelog` command, announcement channel, GitHub webhook
- **Remove Dashboard Close Button** - Redundant with Discord's native "Dismiss Message" on ephemeral messages. Sessions auto-expire via Redis TTL (15 min) anyway.
- **Align Preset Browse UX with Character Browse** - Characters group by owner with clear section headers and consistent emoji badges (from the Emoji Standardization epic). Presets still use a flat list with ad-hoc badging. Needs: owner grouping, standardized emoji badges, consistent legend formatting.

### Tooling Polish

#### 🏗️ Type-Safe Command Options Hardening

- [ ] CI validation for `commandOptions.ts` schema-handler drift
- [ ] AST-based parsing for robustness
- [ ] Channel type refinement

#### 🧹 Railway Ops CLI Enhancements

Low priority quality-of-life improvements.

#### ✨ Dynamic Model Selection for Presets

Fetch OpenRouter model list dynamically instead of hardcoded options.

#### 🏗️ Slash Command UX Audit

Full audit of all slash command UI patterns. Review shared utilities usage, identify gaps/inconsistencies, standardize patterns.

#### 🧹 Free-Tier Model Strategy

Define free-tier model allowlist, usage quotas, upgrade prompts.

#### 🐛 Revisit Vision `maxAttempts` After Telemetry Data

**Problem**: Vision retry cap set to `maxAttempts: 2` (1 initial + 1 retry) on 2026-04-14 without empirical retry-success-rate data for AbortError-originated TIMEOUT errors. Council argued for 1 attempt (0 retries) on the assumption that 90s-budget AbortErrors are near-100% deterministic per URL. Kept 2 attempts until measurement proves otherwise.

**Action**: After 1–2 weeks of prod telemetry from the vision-pipeline diagnostic bundle, grep ai-worker logs for `attempt=2` successes on operations where `attempt=1` failed with `errorCategory=timeout`. If retry success rate on TIMEOUT is <5%, cut `VISION_MAX_ATTEMPTS` in `services/ai-worker/src/jobs/ImageDescriptionJob.ts` to 1. If >20%, keep at 2. Between, reconsider with fresh eyes.

**Why out of scope now**: Cannot decide empirically without the telemetry the diagnostic bundle installs.

#### 🧹 Deduplicate `parseApiError` Calls in Retry Path

**Problem**: `ImageDescriptionJob` (and other vision-adjacent callers) pass both `shouldRetry: shouldRetryError` and `getErrorContext: getErrorLogContext` to `withRetry`. Each wrapper internally calls `parseApiError(error)`, so every failed attempt parses the same error twice. Not a correctness issue — both return the same result for a given input — but inefficient if the parser grows more expensive (e.g., deeper cause-chain traversal, richer classification).

**Action**: Add an optional `getErrorContext` variant that receives a pre-parsed `ApiErrorInfo` instead of raw error, or have `withRetry` expose the parsed info from its own `shouldRetry` call into `getErrorContext`. Either approach removes the duplicate parse without changing the external surface for callers that don't need it.

**Why out of scope**: Efficiency nit flagged during PR #802 review; the parser is currently cheap (regex + switch) so duplication is zero-impact in practice. Fix when touching the retry primitive for other reasons.

#### 🐛 `modelName` Lost as Structured Attribute Field After LLMInvoker Log Deletion

**Problem**: PR #802 deleted the `[LLMInvoker] LLM invocation completed` log which had `modelName` as a top-level structured field (queryable via Railway DSL `@modelName:claude-sonnet-4-6`). The replacement `withRetry` success log embeds model name inside `operationName: "LLM invocation (claude-sonnet-4-6)"` — still substring-searchable but no longer an attribute filter. Per-model latency/success-rate queries are harder.

**Action**: Add an optional `extraLogFields: Record<string, unknown>` option to `RetryOptions` that spreads into every lifecycle log. `LLMInvoker` can then pass `extraLogFields: { modelName }` to restore the structured field without reintroducing a second log line. Alternative: extract model name from `operationName` via a Railway query macro — less ergonomic.

**Why out of scope**: Legit queryability regression but low priority for a solo-dev workflow where substring search suffices. Right home is the Observability & Telemetry Strategy epic in Future Themes — that epic will standardize the `extraLogFields` / `dimensions` pattern across all retry-like primitives.

#### 🐛 Revisit `TIMEOUTS.VISION_MODEL` After Telemetry Data

**Problem**: 90s vision-model timeout may be mis-calibrated. 63% hit rate in 2026-04-14 prod-log analysis suggests systemic (provider/CDN stall) rather than "almost-long-enough." If p95 successful response times are 25–35s, 90s is 2–3x overkill.

**Action**: After 1–2 weeks of prod telemetry, analyze `durationMs` distribution from `[Retry] Image description succeeded on attempt` log entries. Tune `TIMEOUTS.VISION_MODEL` in `packages/common-types/src/constants/timing.ts` to p99 + small headroom.

**Why out of scope now**: Cannot tune without the telemetry the diagnostic bundle installs.
