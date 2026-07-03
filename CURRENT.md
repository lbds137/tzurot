# Current

> **Version**: v3.0.0-beta.146 (released 2026-07-03) — **no migrations**. Headliners: **finish_reason-"error" retryable fix** (#1462 — provider death inside an HTTP 200 no longer delivers garbage or poisons LTM), **both-fail route-chain footer** (#1456 + #1460 — closes the z.ai confusion family), **the Stryker pilot arc** (#1459/#1461/#1463 — config-resolver mutation-score ratchet at baseline 87.81, parallel `mutation-tests` CI job; suite-wide expansion still open), **human-users-only auth invariant** (#1464), **ops logs incident-dig flags** (#1465), **ops:health aggregator + weekly audit cron** (#1466 — cron LIVE from main, Saturdays 09:00 UTC; maiden dispatch ✅ OK with Discord thread delivery proven; webhook secret set). **3 themes CLOSED** (human-users-only, railway-log-DX, periodic-audit). 11 PRs; release review: "nothing survived verification as an actionable bug." _Prior: v3.0.0-beta.145 (2026-07-02) — TTS pointers, lifecycle handling, backlog shrink, guard:workflow-sync (14 PRs)._

---

## Unreleased on Develop (since beta.146)

**Released v3.0.0-beta.146 on 2026-07-03** (notes: [tag v3.0.0-beta.146](https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.146)). `release:finalize` SHA-aligned develop with main — **nothing unreleased on develop.**

**beta.146 post-release state**: weekly audit cron verified end-to-end via manual `workflow_dispatch` (run green, report ✅ OK across the 5-tool roster, Discord thread delivery via `?thread_id=` webhook confirmed — the purple cube posts). First scheduled run: Saturday 2026-07-04 09:00 UTC. One carried watch-item from beta.145: **vision error-pattern recall** (an error phrased outside the new anchors would positive-cache for 1h — promote-when row in `cold/follow-ups.md`).

---

## Next Session Goal

**Finishing-first continues** (user directive 2026-07-03: theme-CLOSERS outrank theme-starters — ordering in `active-epic.md`). The cheap closures are DONE (3 themes closed + released 2026-07-03). Next pulls:

1. **Job-payload contract suite** (deterministic test-quality theme, candidate 2) — the #1184-class catcher and the theme's founding motivation; build-sized. Quick Pact rule-in/out + invariants audit round out the theme.
2. **CPD campaign 1** (`LlmConfigService` ↔ `TtsConfigService` parallel cleanup) — council pass first per the theme.
3. **LLM legacy-column Phase A DROP** — destructive migration; pointer reads soaking in prod since beta.143/145; needs `release:premigrate --allow-destructive` at the release that carries it.

Passive check next session: did the Saturday 09:00 UTC scheduled audit run fire on its own (the dispatch test proved the pipeline; the schedule trigger itself gets its first exercise 2026-07-04).

## Last Session — beta.146 knockout + finishing push (2026-07-02 → 07-03)

**11 PRs merged (#1456–#1466), 3 themes CLOSED, 2 prod bugs fixed same-day.** The z.ai "routing bug" was diagnosed as fallback-visibility (one seam, two symptoms) → both-fail footer chain #1456 + summary-unwrap #1460. The Stryker pilot arc shipped (config-resolver only — per-package expansion remains open in the theme): pilot #1459 (60.71% score against green line coverage — premise validated), 23 gap-closing tests #1461 (→77.74%, logic classes 97.2%), logger-ignorer ratchet #1463 (baseline-and-hold 87.81, full audit-class ceremony, parallel `mutation-tests` CI job ~3min). The finish_reason-"error" prod bug (OpenRouter provider failure inside HTTP 200 → 1-char reply delivered + LTM poisoned) went screenshot→investigation→fix→merged in ~90min (#1462; stable thrown message for classification safety, provider detail preserved via `response_metadata.openrouter.providerError`). Then the **finishing push** (user: "I definitely like finishing stuff" → memory `finish-partial-themes-first`): human-users-only invariant #1464 (the prior bot-block was structurally UNREACHABLE — flag never passed; now compile-enforced from `GatewayUser.isBot` through `X-User-Is-Bot` to `requireUserAuth`), ops logs incident-dig flags #1465 (pull-and-grep-locally, NOT the unreliable server DSL; review caught a real CAC numeric auto-coercion silent-drop on all-digit IDs — empirically confirmed before fixing), ops:health aggregator + weekly cron #1466 (Layers 5–6; maiden run surfaced 2 perma-red roster candidates → excluded with tuning rows, per "false positives are a death spiral"). Review-cycle note: #1465/#1466 each ran 4–5 converging rounds with genuinely real catches (CAC coercion, verdict-header truncation, roster-rot guard, diagnostic fall-through); the round-cap ASK fired twice — user chose fix-then-merge both times. Also: 402 max_tokens auto-reduction evaluated + DECLINED (input tokens dominate this bot's spend); first-ever claude-review run that completed without posting (re-run posted normally — watch for recurrence).

## Last Session — the beta.144 mega-session (2026-07-01 → 07-02)

Epic close → bug blitz → perf forensics → backlog sweep → release. **13 PRs merged** (#1429–#1440 + release #1439). Highlights: Phase 4 C2b shipped after 5 review rounds (each caught a real bug → drove the wiring/seam-test pattern + the assert-at-seam rule #1430); the 20s personality-load stall was forensically traced (prod DB reads + log pulls) to the connection layer — **data volume ruled out** (DB = 422MB total) — yielding the main-pool hardening; a backlog sweep (agent-driven triage of ~298 cold items) found only 1 obsolete entry (the backlog is real, not rot) and clustered ~19 closeable rows; the gateway's 3.5h zombie outage was diagnosed (unguarded shutdown re-entry loop, 57M dropped log lines) and fixed in-release. Review-cycle discipline note: reviewers caught two wiring gaps in my own compound-error PR (category flip via message-regex classification; log-only field never reaching Discord) — the seam-testing rule works both ways.

## Last Session — beta.142 review-followup sweep (2026-06-30)

After releasing beta.142, cleared the review-follow-up backlog so the next epic starts clean (user: "too many loose ends to feel comfortable starting a new epic"). Six planned PRs; **5 shipped, 1 deferred**, all to develop, no migration:

| PR        | Outcome                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1402     | gateway cleanup — `findFirst`→`findUnique` on all **4** AdminSettings-singleton reads (grep found 4; reviewer named 2), manifest `'all'` sentinel, temporal scrub, ModelCapabilityService per-call **kept** (stateless wrapper; threading it = net-negative) |
| #1403     | clear-default **per-slot fallback** — `newEffectiveDefaults: {text?,vision?}`; an `all`-clear now names BOTH slot fallbacks                                                                                                                                  |
| #1404     | test-gap closure — handleSet vision-slot, delete-guard null-singleton, gemma-4/llama-vision (VISION_MODEL_PATTERNS was already well-tested — stale follow-up; verify-before-acting)                                                                          |
| #1405     | capability-agnostic owner `/preset global` picker (admin LIST → `parseConfigKindQueryAllowAll`; matches the user pickers)                                                                                                                                    |
| #1406     | OpenRouterModelCache in-flight dedup — **3 review rounds**: round-2 refreshCache hardening introduced a stale-key bug → **reverted in round-3**, kept the clean core + race-safe identity-check, backlogged the refreshCache interaction                     |
| PR3 (def) | wire the write-only default pointers into the resolver cascade → **folded into Phase 4** (cascade-ordering IS Phase 4's job; the follow-up's own promote-when said "Slice 4")                                                                                |

~11 follow-ups removed/trimmed from `cold/follow-ups.md`. PR6 items 2 & 3 (browse session-cache, `take:100`→`hasMore`) left **trigger-gated** — premature optimization for unobserved problems. Every PR: green CI + read-every-review + autosquash-before-merge. A beta.143 release is due when the user calls it.

## Last Session — backlog restructure: HOT/COLD + granularity ladder (2026-06-17)

Reworked the backlog system end-to-end after the deferred-vs-icebox distinction collapsed and several section files re-grew into monoliths. 4-model council pass (Gemini 3.1 Pro, GLM 5.1, Kimi K2.7-code, Qwen 3.7 Max) → plan → executed as **PR #1245** (merged 2026-06-17, 37 files, 3 clean review rounds).

- **HOT/COLD split.** Session-start load dropped ~2500 → ~350 lines. HOT: `BACKLOG.md` (manifest) + `now.md` (prod-issues/focus/quick-wins/untriaged, capped) + `active-epic.md` (roadmap, dense per-PR log split to `cold/epic-log.md`) + `references.md`. COLD (grep-on-demand): `cold/queue.md` index + 28 `cold/themes/*.md` (future-themes exploded) + `cold/ideas.md` (icebox) + `cold/follow-ups.md` (deferred, re-cut as a table).
- **Granularity ladder** replaces Deferred/Icebox: epic → `themes/`; paragraph idea → `ideas.md`; one-sentence follow-up → `follow-ups.md`. Trigger is a field, not a bucket.
- **Staleness principle (user directive):** aging escalates priority, never deletes; removal only when done or grep-verified obsolete. Baked into `06-backlog.md`; surfaced by the new `pnpm ops backlog` lint (oldest-follow-ups nudge).
- **Also this session (pre-restructure):** inbox triaged to zero (10 items routed); beta.133 close-out (CURRENT.md/production-issues swept); MCP/council memory updated (GLM 5.1→5.2).
- **Net:** the next session loads a focused hot surface instead of the full archive. Tooling/docs only — no runtime change, no migration.

## Last Session — beta.133: context-assembly fix family + release (2026-06-17)

Diagnosed and fixed the full context-assembly bug family surfaced in the beta.133 dev smoke, plus a prod release-stopper (`/character import` broken). 9 PRs to develop, no migrations.

| PR    | Title                                                                        | Outcome                                                                                                                                |
| ----- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| #1236 | `fix(bot-client): normalize our-authored messages in extended context (A+B)` | Strips `-#` footers (incl. incognito) from replayed content; reclassifies our-authored extended-context copies off `role:assistant`    |
| #1237 | `fix(context): history dedup + weigh-in persistence + vision misroute`       | Collapses duplicate channel-history rows sharing a Discord id; persists weigh-in/chime-in with the right role; derives vision provider |
| #1239 | `fix(api-gateway): resolve LLM model config once at job-chain build (Bug X)` | Image-description jobs stamp the user's resolved `{model,visionModel}`, not the global default                                         |
| #1240 | `fix(ai-worker): resolve cross-provider vision key in the RAG path (Bug Y)`  | RAG vision call resolves the cross-provider key → no more `401 Missing Auth`                                                           |
| #1241 | `feat(ai-worker): persist reference-image descriptions durably`              | `resolvedImageDescriptions` persisted onto the trigger row → quoted/replied images survive the ~1h vision-cache TTL                    |
| #1242 | `fix(common-types): preserve attachment markers in deduped reference stubs`  | Attachment markers folded into stub content (markers-first vs end-truncation) → image-only reply-target no longer blank                |
| #1243 | `debug: remove beta.133 context-assembly probes`                             | Removed the 3 dev probes (`EMBED_PERSIST`/`CTX_MERGE`/`VISION_AUTH`) once A/B/C verified                                               |
| #1244 | `Release v3.0.0-beta.133`                                                    | Clean rebase-merge; `release:finalize` SHA-aligned develop; holistic review surfaced one non-blocking `findFirst` tiebreak follow-up   |

### Net result

- **The original "image renders blank" symptom was mis-attributed** (caught via `/inspect` runtime evidence): the root was vision _failing_ (Bug Y's 401), not a persistence gap. Bug X (#1239) + Bug Y (#1240) fixed the failure; the genuine remaining gap — referenced/quoted image descriptions being **cache-dependent** — became #1241's persist-on-describe. The direct-image `attachmentDescriptions`/`messageUpdate` WIP was reverted as targeting a non-issue.
- **The import release-stopper rode along for free.** Root-caused (runtime-confirmed via the 2507ms abort matching prod's `AUTOCOMPLETE=2500` default) to the missing write-aware timeout default on the gateway client — already fixed on develop by #1228 (`GATEWAY_TIMEOUTS.WRITE=20s`, method-aware default), so it shipped in beta.133 with zero new code. Track (a) of the preset-PUT-timeout (gateway slowness root cause) stays open.
- **`CTX_MERGE_PROBE` settled the A/B/C root**: clean DB rows + footered/relay live copies that failed to dedup against them (mismatched `discordMessageId`). Embed-only half of Bug C deferred (filed to inbox; simple `isForwarded &&`-gate-drop fix identified via `EMBED_PERSIST_PROBE`).

## Last Session — z.ai backlog sweep (2026-06-14)

Cleared the whole z.ai backlog the user pointed at, small → large. 5 PRs merged to develop (no migrations).

| PR    | Title                                                                          | Outcome                                                                                                                        |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| #1202 | `fix(api-gateway): z.ai-key-required message + admin-route z.ai-only coverage` | dedicated "needs a z.ai key" message vs misleading "model not found"; admin create/update z.ai-only coverage                   |
| #1203 | `feat(bot-client): "requires z.ai key" badge on preset dashboard`              | gateway-computed `requiresZaiKey` (viewer-keyed, only for z.ai-only models absent from OpenRouter) → dashboard badge           |
| #1204 | `feat(ai-worker): broad free-vision fallback for cross-provider auth gaps`     | unified `resolveVisionConfig` (auth+model atomic); authenticated-no-vision-key → free gemma on system key instead of fail-fast |
| #1205 | `feat(ai-worker): per-user daily cap on system-key free-vision fallback`       | new `VisionFallbackQuota` (per-user/UTC-day Redis INCR, fail-open) — the council-flagged abuse guard                           |
| #1206 | `feat(ai-worker): raise system-fallback vision cap 20→100/day`                 | $0 model → cap only protects the shared pool; 100 is the sensible default                                                      |

### Net result

- **Item 3 was moot, not built.** The "model autocomplete" it assumed doesn't exist (model IDs are free-typed in a Discord modal). Reframed into a `/models`-browser command backlog item.
- **Item 5 (the big one) was council-reviewed first** (GLM-5.1 + Qwen-3.7-Max), which caught the freeloading surface → became the #1205 guard. Implementation delegated to a subagent, then human-reviewed (resolveVisionConfig core, both call paths, the describeImage contract, the file extraction) before commit.
- **Three verify-before-accepting catches** that would each have shipped the wrong thing: item-3 premise (moot), #1204's "Redis-blip bug risk" (moot — the cache read already degrades), and #1205's spec ("reuse RateLimitCache" — it's a reactive 429-cache, not a counter; needed a new INCR primitive).
- **Item 6** got a design proposal (free-tier piggyback), no code, per user call.
- Backlog fully swept of shipped items; one new follow-up filed (admin-settings cap knob).

## Last Session — beta.130: z.ai GLM-5 + release (2026-06-14)

| PR    | Title                                                                   | Outcome                                                                                                                                             |
| ----- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1197 | `fix: support GLM-5 on z.ai coding plan + z.ai-aware config validation` | `glm-5`/`glm-5.2` added to `ZAI_MODEL_CATALOG`; validation short-circuits to the catalog when the user has a z.ai key; `userHasActiveApiKey` helper |
| #1198 | `fix: ground z.ai catalog context lengths in z.ai docs`                 | Values verified against z.ai docs (`glm-5-turbo` 256K→200K); runtime clamp now provider-aware (z.ai-direct → catalog, keyless → OpenRouter cache)   |
| #1199 | `chore(deps): force esbuild >=0.28.1`                                   | Clears Dependabot #109 (dev-only, Windows-only advisory; pnpm override pattern)                                                                     |
| #1200 | `Release v3.0.0-beta.130`                                               | 9 PRs, no migrations; clean rebase-merge; holistic release review no-blocking                                                                       |

### Net result

- **z.ai GLM-5 asymmetry root-caused and fixed.** `glm-5` was missing from the catalog → `isZaiCodingPlanModel` false → no auto-promotion → silently ran on OpenRouter ("5.1 works, 5 doesn't"). Fix added the catalog entries + made both save-time validation and the runtime clamp z.ai-aware, capping from the provider the request actually hits. Catalog values were then verified against z.ai's own docs (a "203K" question from the user surfaced that the shipped numbers were conservative guesses; one — `glm-5-turbo` — was genuinely wrong-high at 256K).
- **Backlog hygiene correction**: declined to file a "final hard context cap" backstop — user clarified icebox/deferred are for future work, not decided-against ideas. Captured as a feedback memory.
- **Release mechanics clean**: unlike beta.129's 104-commit rebase failure, the 9-PR delta rebase-merged without issue.

## Last Session — beta.129: context clamp + release (2026-06-12)

| PR    | Title                                                            | Outcome                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1186 | `fix(ai-worker): clamp context budget to the model's real limit` | Shared `computeContextCap` (75% ≤64k / 50% above) in common-types; gateway validation + worker runtime clamp (`contextWindowResolver`); `effectiveContextWindowTokens` required; warn on clamp |
| #1187 | `fix(bot-client): update context-window UI text`                 | Modal label `(capped per model)` replaces the now-wrong `(max 50% of model)`; 3 stale doc comments refreshed                                                                                   |
| #1188 | `Release v3.0.0-beta.129`                                        | 18 PRs, no migrations; FF-fallback merge (rebase refused at 104 commits); hono advisories clear on main                                                                                        |

### Net result

- **Small-context overflow root-caused and fixed in three layers.** Prod row was correctly configured at 32768 — the bug was ours: validation exempted ≤64k models from the headroom cap, the budget filled the full window with no output reserve, and tiktoken undercounts Mistral-family tokenizers ~20% (32768 budgeted ≈ the observed ~40k). One shared formula now enforces the cap at save time and generation time; pre-existing oversized rows need no migration (runtime clamp + warn). Dashboard ⚠️ picks up the new cap automatically (it renders the gateway's `contextWindowCap`).
- **Review-cycle note**: claude-review re-raised the pre-existing `content as string` token-count cast across four rounds — it's filed once in inbox. Two release-review headline claims verified FALSE before echoing (max-lines "would fail CI" — eslint exits clean, the rule skips blanks/comments; thin-payload guard "doc-only" — runtime enforcement exists in `selectContextVariant`).
- **Steam Deck push flake recurred 3× in one session** (background AND foreground-filtered pushes showing success without transferring); every push now verified via remote-SHA comparison per the standing memory rule.

_b-1 burn-in (earlier): promoted path verified — 10 jobs, 0 errors, weigh-in null-persona + LTM skip clean, Fork-C vision ordering holds (proven via the per-generation epoch-query fingerprint since the path was silent)._

## Last Session (continued) — voice ground truth shipped: pre-iii-b queue empty (2026-06-07)

| PR    | Title                                                                            | Outcome                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1169 | `feat: rawMessageContent becomes Discord ground truth; STT divergence telemetry` | Council a′ implemented: ground-truth content, telemetry-only `rawRoutingTranscript`, voice shadow-skip deleted, `sttDivergence` metric (excluded from allMatched) |

### Net result

- **The envelope's content field has one meaning.** `rawMessageContent` = `message.content` verbatim (empty for voice AND forwarded triggers); the transcript rides `rawRoutingTranscript` as telemetry only. The shadow compares content for every trigger type — the voice skip is gone.
- **`sttDivergence` is the single-STT decision's dataset**: `equal` mirrors `compared` exactly (asymmetric runs are "uncompared", never "diverged" — review round 2's catch, user-approved), and the multi-attachment join-strategy precondition is documented at the join site + in deferred.md.
- **4 review rounds, fast convergence**: round-1 trivial comment + log-noise deferral; round-2's genuine catch (the equal/compared guard asymmetry); round-3 `bothTranscriptsPresent` extraction; post-autosquash = confirmations only.

## Last Session — beta.128: prod contract-drift fix + manifest-conformance enforcement (2026-06-07)

| PR    | Title                     | Outcome                                                                                                                                                                                        |
| ----- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1168 | `Release v3.0.0-beta.128` | Hotfix release off main: personality update/visibility contract fix, 3 latent manifest-drift fixes, 145-route conformance harness + completeness gate, `sendContractSuccess`, codecov PyPI fix |
| #1167 | (closed, superseded)      | The develop-targeted twin of the hotfix; the patch reached develop via the post-release rebase                                                                                                 |

### Net result

- **Prod bug class closed structurally, not just symptomatically.** The harness replays every manifest route end-to-end (real auth middleware, PGLite, mock Redis) and safeParses the wire body through the declared `output` schema — the same validation the typed clients run in prod. 135 success-path / 10 justified skips (live third-party round-trips). Three latent drifts found and fixed before they ever had callers.
- **Two enforcement layers going forward**: the registry bijection test (new route ⇒ fixture or written skip reason, else red unit suite) and compile-time payload typing via `sendContractSuccess`. The gate proved itself immediately: develop's four Phase-2.5 internal routes failed it during the post-release rebase and got fixtures on the spot.
- **Release mechanics first-of-kind**: release branch off main (`chore/release-v3.0.0-beta.128`) instead of develop→main; develop rebased onto main afterwards (52 commits replayed, the codecov cherry-pick dropped via patch-id, one semantic conflict: `ConversationRetentionService` moved into api-gateway on develop — harness import repointed). The pre-push branch-name hook doesn't admit a `release/` prefix, hence the `chore/` name.
- **3 review rounds, all LGTM**; remaining nit (BOT_OWNER_ID env restore in harness cleanup) is test hygiene for a future touch. Backlog: int-coverage include-glob gap filed to inbox (`services/**` was never collected by the integration coverage upload).

## Last Session (continued) — Fork C shipped: zero bot-client conversation writes (2026-06-06)

| PR    | Title                                                                           | Outcome                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| #1166 | `feat(ai-worker): persist vision descriptions worker-side post-vision (Fork C)` | `VisionDescriptionWriter` (post-vision, never-throws, own Prisma); bot `updateUserMessage` deleted; descriptions now survive generation failure |

### Net result

- **The producer of attachment descriptions persists them.** The write happens in DependencyStep immediately post-vision — decoupled from generation success, with a shorter placeholder window, and a DB failure can no longer break delivery (the old call sat unguarded in the bot's pre-send path).
- **bot-client conversation writes: zero.** The transitional local-Prisma note from iii-0 is discharged; what remains for 2.5d is reads only.
- **2 rounds + final**: round-1's genuine catch (the `''` descriptions guard — applied with user approval in the explicit-comparison form) + code-name scrub (the reviewer correctly turned the temporal-marker rule on "Fork C" labels); round-2 + final = confirmations, incl. the reviewer verifying the raw-personality-id-vs-effective choice and that analysis getting encoded as the inline comment.

## Previous Session — ii-3 shipped: a3 complete, 12 shadow surfaces (2026-06-06)

| PR    | Title                                                                                 | Outcome                                                                                                                                   |
| ----- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| #1165 | `feat(ai-worker): PR 2.5c-iii-a3-ii-3 — cross-channel decoration + full-diff wrap-up` | Cross-channel via shared wire mapper + env-map decoration; shadow surface 12 closes the 2.5a count-only caveat; all fold-forwards applied |

### Net result

- **The assembler re-derives the complete context.** Cross-channel groups fetch through the worker's own dataSource, decorate from the envelope's cache map (misses → shared fallback), and serialize through the SAME mapper the bot uses. The diff is presence-strict/group-key-strict/message-tolerant with env-name drift counted-but-excluded — the one by-design divergence (cache-vs-live decoration) stays observable without poisoning the go/no-go metric.
- **`satisfies` keeps paying**: the fold-forward predicted two missing wire fields (channelId/guildId); the compiler found two more (id/personaId). All four now filled with the diff's own normalization sentinels instead of hiding behind a cast.
- **2 review rounds + final, fast convergence**: round-1 = one threading refactor (excludeChannelId from the narrowed guard, killing a `?? ''` and its comment-documented assumption); round-2 = one reviewer false-premise dismissed with citation (`?? undefined` is a load-bearing null→undefined conversion, maxAge is `number \| null`); final = nits self-resolved by green typecheck.

## Last Session — ii-2 shipped + Codecov outage diagnosed and routed around (2026-06-06)

| PR    | Title                                                                                     | Outcome                                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1163 | `feat(ai-worker): PR 2.5c-iii-a3-ii-2 — worker-side mention rewriting + link replacement` | Mention kernels shared (bot = thin adapter, 27 tests exercise REAL kernels); `[Reference N]` from wire numbers; shadow = 11 surfaces                   |
| #1164 | `fix(ci): install codecov CLI via PyPI instead of the keybase-verified binary`            | Global Codecov outage routed around: keybase 404 body piped into gpg killed every upload; `use_pypi` keeps PyPI integrity checks — permanent hardening |

### Net result

- **The mention scan/dedup/cap/placeholder ordering rules live once** in `mentionRewriter.ts`; MentionResolver delegates, the worker's `rewriteRawContent` mirrors the bot's step-5 order exactly, and the existing bot tests verify the kernels through the adapter. One user-approved behavior change rode along: snowflake validation on user-mention ids (junk `<@1>` no longer costs a DB round-trip), applied atomically to both sides.
- **5 review rounds converged**; rounds were trivial autos + verified dismissals; the reviewer's "missing isValidDiscordId" Medium was verified as a faithful-port of pre-existing behavior, then approved as an improvement.
- **Codecov broke globally mid-merge** (Keybase key 404, fallout from the Harness acquisition week; codecov-action#1955, also took down mozilla/pdf.js CI). Diagnosed to the exact wrapper line (`curl -s` without `--fail` piping a 404 body into gpg), routed around via `use_pypi: true` on all 7 upload steps (#1164 — keeps pip's integrity checks, permanent keybase-independence), then #1163 rebased onto the fix and merged green.
- **iii-b design question now on record**: the voice content story (envelope rawMessageContent = transcript; payload message = empty refetched content; transcript-as-message at cutover would double with the attachment-description path).

## Previous Session — a3-ii sliced; ii-1 shipped: worker-side reference enrichment (2026-06-06)

| PR    | Title                                                                     | Outcome                                                                                                                                                |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1162 | `feat(ai-worker): PR 2.5c-iii-a3-ii-1 — worker-side reference enrichment` | Shared dedup/stub/transcript kernels (bot delegates); `authorIsBot` envelope gap closed (`z.literal(true)`); shadow gains `referencedMessages` surface |

### Net result

- **a3-ii sliced ii-1/ii-2/ii-3** (references / mentions+links / cross-channel) — each independently diffable; ii-1 done.
- **Three kernels relocated with bot-side delegation** (zero-drift): the dedup decision (injectable now-anchor — worker passes job enqueue time, the closest stand-in for crawl-time wall clock), the stub shape (bot now builds raw-then-stubs, so dedup-agreement stubs are byte-identical by construction), the transcript format (bot keeps Redis+DB tiers; worker DB-only via new `ContextDataSource.getMessageByDiscordId` — accepted divergence).
- **Self-caught documentation error**: the planned "forwarded-dedup count asymmetry" divergence can't happen — a bot-deduped forward ships ONE raw container ref, so counts always align; the real shape is per-number dedup disagreement. Caught while covering the diff's missing-number branch; module doc + PR body corrected.
- **6 review rounds, all converging**: round-1 = self-caught fix + codecov line; round-2 = two user-approved asks (Promise.all transcripts, `extraInAssembled` — refined to true set-difference in round 4); round-3 = three trivial autos (incl. forwarded+deduped precedence test); rounds 5–6 = user-approved trio (`?? null` adapter totality, `z.literal(true)` presence-encoding, explicit set-identity guard) + observations. One reviewer item recurred 4× on a verified-false premise (retriever typed `string \| null`) — dismissed each round with the same citation; killed permanently by the `?? null` normalization.
- **Process potholes**: `== null` tripped the eqeqeq pre-commit (normalize-first form fixed it); a stale-staging accident routed an ai-worker file into the common-types-targeted fixup (would have conflicted at autosquash) — caught pre-push, split via soft reset; the vacuous-push trap fired once and was caught by output verification.

## Previous Session — iii-a3-i shipped: the assembler core exists (2026-06-05)

| PR    | Title                                                                          | Outcome                                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1161 | `feat(ai-worker): PR 2.5c-iii-a3-i — context assembler core + assembly shadow` | `ContextAssembler.assembleCore` + `shadowAssembleAndDiff` (7-surface diff, never-throws); shared impls relocated to common-types; `rawAuthorDisplayName` |

### Net result

- **The worker can now re-derive the core context from the envelope + its own Prisma**, and every envelope-bearing job emits one `ShadowAssembly` telemetry line (`allMatched` + per-surface booleans). Error contract split: assembler THROWS (cutover = real job failures), shadow owns never-throws.
- **Zero-drift by relocation**: `historyMerger` + `extendedContextPersonaResolver` + `INTERNAL_DISCORD_ID_PREFIX` moved to common-types; both paths call the SAME functions (runSync pattern).
- **Two genuine gaps surfaced**: `rawAuthorDisplayName` (fixed end-to-end this PR — `getOrCreateUser` persona naming needs it) and wire-shape `channelId`/`guildId` (the reviewer's `satisfies` suggestion failed for a better reason than type hygiene — the `as` cast was masking a cutover prerequisite; documented + queued for a3-ii).
- **3 review rounds, fast convergence**: round-1 = 4 comment-shape autos + codecov line closed; round-2 = one 🔴 dismissed with evidence (`getOrCreateUser` displayName is optional with documented internal fallback — reviewer's "type hole" premise false); final = observations only, all folded forward.
- **Push-transfer flake fired a third time** (remote ref never created despite clean hook output); caught by the `git ls-remote` verification habit before any CI watching.

## Previous Session — iii-a2 shipped: the envelope is complete (2026-06-05)

| PR    | Title                                                                   | Outcome                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1160 | `feat(bot-client): PR 2.5c-iii-a2 — complete the raw assembly envelope` | Raw reference snapshots via MessageFormatter pure/enriched split; channel/role mention raws; schemas → `types/schemas/rawEnvelope.ts`; ReferenceFormatter decomposed |

### Net result

- Every Discord-origin input the worker assembler needs is on the wire when `CONTEXT_RAW_ENVELOPE=true`. Two properties make worker-side re-derivation sound: numbering is dedup-independent (stubs consume numbers) and the raw side never stubs/transcribes.
- Roles were the genuinely uncoverable gap (channels had the env map); both now captured from the mention resolver's existing guild-cache-pure output — no re-scanning.
- 3 review rounds: 4 trivial autos → 2 test-coverage Mediums + nit autos → observations only (incl. one reviewer guess corrected by verification: trackLink is LAST-wins, not first-wins).

## Previous Session — iii-a1 shipped + hono sweep (2026-06-05) — the worker-side full context assembler, the epic's last big build. It consumes the now-shipped `rawAssemblyInputs` (iii-a1, #1159): ContextDataSource grows persona resolution + `getOrCreateUser`/batch upserts; HistoryMerger-equivalent merge of hydrated DB history with envelope-carried extended-context messages; mention/reference content rewriting; cross-channel decoration from the envelope's channel-env map. All behind an EXTENDED shadow mode with real-DB hydration (GLM's catch) and match-rate telemetry whose go/no-go threshold gates iii-b (Qwen). Fold-forwards riding along (listed in active-epic.md): populate `rawReferencedMessages` (shape it by the assembler's needs), two schema doc one-liners, raw-envelope schema extraction, `buildGuildEnvironment` param type. Burn-in flags now available end-to-end on dev: `CONTEXT_MODE=service` + `CONTEXT_RAW_ENVELOPE` + `CONTEXT_SHADOW_HYDRATION` + `CONTEXT_DUAL_WRITE`. Watch: CPD ratchet at 1727/1728 — a2 may legitimately trip it (triage then rebaseline per documented procedure, never bypass).

## Previous Session — iii-a1 shipped + hono sweep (2026-06-05)

| PR    | Title                                                                            | Outcome                                                                                                                                                             |
| ----- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1159 | `feat(bot-client): PR 2.5c-iii-a1 — raw assembly inputs ride the legacy payload` | `rawAssemblyInputsSchema` + `RawEnvelopeBuilder.ts` behind `CONTEXT_RAW_ENVELOPE`; pre-mutation extended-context snapshot; Fork-A channel-env cache map (5-min TTL) |
| #1158 | `fix(deps): bump hono override to >=4.12.21 for four advisories`                 | 4 Moderate dependabot alerts cleared; dev-only transitive via prisma → @prisma/dev; override range gap (4.12.16–4.12.20) closed as a bonus                          |

### Net result

- **The thin envelope now exists on the wire** (optional, flag-gated): pre-rewrite content, mention targets, pre-resolution extended-context snapshot + user batches, channel-env map. This object IS iii-b's payload — one key flips at cutover.
- **Mutation-timing catch**: `resolveExtendedContextPersonaIds` rewrites fetched messages in place, so the snapshot is captured immediately post-fetch (deep clone, flag-gated for cost) — otherwise the shadow assembler would verify against its own answers. Tested with an explicit mutate-after-snapshot guard.
- **Type-drift killed structurally**: `ApiConversationMessage` derived via `z.infer` from the schema (round-2 review suggestion, typechecked clean first try).
- **3 review rounds converging fast**: round-1's four trivial items auto-applied; round-2's two applied (clone-asymmetry comment + the infer derivation); final = LGTM with doc-line fold-forwards only.

## Previous Session — 2.5c-iii council + iii-0 shipped (2026-06-04 → 05)

## Previous Session — 2.5c-iii council + iii-0 shipped (2026-06-04 → 05)

| PR    | Title                                                                             | Outcome                                                                                                                                                           |
| ----- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1157 | `feat(api-gateway): PR 2.5c-iii-0 — user-message persist endpoint + mode cutover` | `POST /internal/conversation/user-message` (gateway = Discord-event data authority, synchronous pre-submission); `saveUserMessageFromFields` mode branch + mirror |

### Net result

- **2.5c-iii scoped via council** (GLM-5.1 + Kimi-K2.6 + Qwen-3.7-max): Fork B unanimous premise correction (user message = Discord event → gateway endpoint pre-submission, NOT worker persist — kills the rapid-follow-up ordering race outright); Fork A = full guild→channel cache map in envelope (2-1, Qwen's full-dump refinement); Fork C = worker updates vision descriptions via own Prisma post-vision (bot-side round-trip dies in iii-a); Fork D unanimous discriminated union. Slicing iii-0/a/b with three sharpening catches recorded.
- **iii-0 shipped**: shared-once timestamp resolution (deterministic row UUID derives from it — independent `new Date()` defaults would have produced false divergence on every metadata-less message); vision-description update documented as transitional local-Prisma until iii-a.
- **Structural fix from a CI/local discrepancy** (user-spotted): CI's lint job runs `pnpm ops test:audit` but local `quality` never did — the iii-0 schemas' missing contract tests passed locally and failed CI. Tests added AND `test:audit` joined the root `quality` chain; the discrepancy class is dead.
- **CPD headroom note**: ratchet at 1727/1728 ceiling — one grace line left; iii-a may trip it legitimately (mirrored endpoint-family code).
- **Hono dependabot sweep** (#1158): 4 Moderate advisories, all dev-only transitive via `prisma → @prisma/dev → @hono/node-server`; existing override bumped `>=4.12.16 → >=4.12.21` (resolves 4.12.23).

## Previous Session — PR 2.5c-ii shipped (2026-06-04)

| PR    | Title                                                                     | Outcome                                                                                                                                                                     |
| ----- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1156 | `feat(bot-client): PR 2.5c-ii — routing-read cutover behind CONTEXT_MODE` | `HttpPersonalityLoader` over the 2.5b routing endpoint; positive (5 min)/negative (60s) tiers keyed `(userId, nameOrId)`; pub/sub invalidation via `PersonalityCacheTarget` |

### Net result

- All routing-path personality resolution (mention parsing, reply resolution, activation, multi-tag recovery, `/character chat`) is HTTP-backed in service mode; legacy wiring byte-identical via two fallback variables.
- Cache design is load-bearing: `PersonalityService` skips its cache whenever userId is present, so every probe was a DB query already; negative tier absorbs the mention-candidate miss storm; transport errors never negative-cached.
- `PersonalityCacheTarget` interface (common-types) lets `CacheInvalidationService` drive whichever cache is live — `PersonalityService` satisfies it structurally, zero change for existing consumers.
- Test-infra gotcha documented: lru-cache snapshots `performance.now` at module load (fake timers can't expire TTLs → injectable clock) and a clock starting at 0 makes entries immortal (falsy start = "no TTL").
- 2 review rounds + final: round-1's four nits all auto-applied (trivial-shape); round-2 nits-only; final reviews' polish items folded forward to c-iii, two trigger-gated items (single-flight dedup, surgical eviction) → deferred.md.

## Previous Session — PR 2.5c-i shipped (2026-06-04)

| PR    | Title                                                             | Outcome                                                                                                                                                                               |
| ----- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1155 | `feat(bot-client): PR 2.5c-i — write cutover behind CONTEXT_MODE` | `CONTEXT_MODE` born (legacy default = zero change); service mode flips assistant persist + edit/delete sync to the 2.5b gateway endpoints; write-path cluster → `contextWritePath.ts` |

### Net result

- 2.5c sliced (user-approved): i = write cutover (this PR), ii = routing reads, iii = hydration. `CONTEXT_MODE=service` flips whatever has shipped — one toggle, incremental meaning.
- Error contracts preserved exactly: persist throws on failure (legacy-identical, caller catch paths untouched); sync never throws (opportunistic contract). Shared payload builders keep authoritative/mirror wire shapes drift-proof.
- `contextWritePath.ts` extraction (forced by max-lines, but the right home): one cohesive module, one deletion story in 2.5d.
- Review: one-round convergence, zero asks ("Correct, well-tested, rollback-safe... Ready to ship"); two reviewer-routed 2.5d fold-forwards filed (type-name consolidation; truncation-warn severity upgrade post-legacy).

## Previous Session — PR 2.5b shipped (2026-06-04)

| PR    | Title                                                                       | Outcome                                                                                                                                                                                          |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1154 | `feat(api-gateway): PR 2.5b — internal conversation endpoints + dual-write` | 3 internal routes (assistant-message persist, combined edit/delete sync, personality routing read) + bot-client dual-write behind `CONTEXT_DUAL_WRITE`; sync algorithm relocated to common-types |

### Net result

- **Gateway owns the assistant history row on delivery confirmation** (user-approved fork): derives +1ms timestamp/deterministic UUID/token count via the same `addMessage` path bot-client uses — dual-write rows match by construction; existing row → compare-don't-overwrite with `matched: false` as the divergence signal; P2002 race → compare fallback (other errors surface as 500).
- **Combined sync endpoint** (user-approved fork): diff algorithm relocated from SyncExecutor/SyncValidator into `ConversationSyncService.runSync`; legacy path delegates to the same method — zero drift possible. `SyncValidator` (untested, structure-test-excluded) died; its replacement has a colocated test suite and the exclusion is removed.
- **Routing read discovery**: mention parsing is candidate-probe (not list-scan) → single lookup endpoint suffices; startup `loadAllPersonalities` is just a connection-check count. 2.5c prerequisite: negative caching (recorded in epic doc).
- **3 review-respond rounds, converging**: round-1 P2002 guard + log dedup + manifest caps (user-approved); round-2 truncation warn (user-approved); round-3 log field + a reviewer false claim corrected (the "relocation added a DB round-trip" premise was wrong — old code made the same two queries; my round-2 epic-doc echo of it fixed per verify-before-echoing). Final reviews' 4 remaining nits folded forward to 2.5c/2.5d entries.

## Last Session — Phase 2.5 scoping + council + PR 2.5a shipped (2026-06-04)

| PR    | Title                                                                 | Outcome                                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1153 | `feat(ai-worker): add ContextDataSource and shadow context hydration` | `ContextDataSource` interface + `PrismaContextDataSource` (wraps the same shared services bot-client uses) + fire-and-forget `shadowHydrateAndDiff` gated on `CONTEXT_SHADOW_HYDRATION`; 19 new tests |

### Net result

- **Phase 2.5 scoping complete**: bot-client's DB surface enumerated into 3 clusters — (A) per-message context reads, (B) persistence writes, (C) startup `loadAllPersonalities` — evidence + council verdict (Fork 2, unanimous) recorded in active-epic.md, including the routing-reads caveat the council under-weighted.
- **2.5a shipped**: ai-worker can now re-hydrate DB-derived context per job and diff against the bot-client payload, log-only (`matched` info / `DIVERGED` warn). Tolerant diff by design: `extraInHydrated` = expected timing drift; missing rows / timezone mismatch / fewer cross-channel groups = divergence. Zero production behavior change with the flag off (default).
- **Known burn-in signals documented in the module JSDoc**: limit-derivation divergence (bot-client `extendedContext?.maxMessages` vs resolved cascade) and count-only cross-channel comparison (wire `CrossChannelHistoryGroupEntry` vs DB `CrossChannelHistoryGroup` shape mismatch — 2.5c must unify).
- **Post-merge round-5 review triage**: `.env.example` entry applied on develop (this commit); `nullToUndefined` utility dismissed (2 call sites, wrong trade); inline-comment placement nit dismissed.

## Previous Session — PR-2o: single-consumer relocations + falsified resolver-stack assumption (2026-06-04)

| PR    | Title                                                                 | Outcome                                                                                                                                                             |
| ----- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1152 | `refactor(common-types): relocate single-consumer services to owners` | `ConversationRetentionService` → api-gateway; `VisionDescriptionCache` → ai-worker; resolver stack falsified as 2-consumer → re-routed to PR-2p; epic doc corrected |

### Net result

- The mandated value-import re-verification (construction-site matrix, comments excluded) **falsified the epic's expected move set**: the config-resolver stack has real api-gateway production constructions in the cascade-resolution routes, so it's 2-consumer and belongs in 2p's shared package — 2p's scope formally grew (charter check: Kimi's ~15-file boundary warning flagged in the epic doc).
- `VisionDescriptionCache` was a single-consumer the original map missed entirely — now in ai-worker.
- Deliberate non-moves documented with reasons: `ConversationSyncService` (Prisma-backed, would entrench the 2.5 drift), `ChannelActivationCacheInvalidationService` (pub/sub pair → 2q), `tts/` dir (multi-consumer contract surface).
- common-types `services/` shrinks by 6 files; redundant retention describes removed from the history int test (coverage preserved in the relocated int test — verified, including that the deleted block's interpolated `$executeRawUnsafe` fixture died with it).
- Drive-by: `03-database.md` stale "L1+L2" row for VisionDescription corrected (L2 removed in beta.110).
- The deferred tripwire fired its first organic reminders during this PR's commit.

## Last Session (evening arc) — Backlog-quality campaign: 2 PRs + deferred/icebox prune + tripwire (2026-06-03)

Continuation of the same day: after the quick-wins sweep below, the session pivoted to backlog quality — auditing trigger-gated items, fixing the ones whose triggers had fired, pruning the rot, and making the "opportunistic" trigger class structural.

| PR    | Title                                                          | Outcome                                                                                                                                                                                |
| ----- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1150 | `fix(bot-client): wrap first-ack error branches against 10062` | New generic `ackWithTimeoutCatch` (showModalWithTimeoutCatch now delegates to it); 5 exposed branches wrapped across memory detailModals + deny detailEdit; closed 4 deferred entries  |
| #1151 | `feat(tooling): deferred-backlog tripwire`                     | `pnpm ops dev:deferred-refs` parses deferred.md path tokens, matches staged files, prints reminders via pre-commit (never blocks); makes "opportunistic when touching X" triggers fire |

### Backlog-quality results

- **Deferred audit**: all 113 entries read; trigger-quality tiers identified (~40% real gates, ~25% observational, ~35% "opportunistic" = hope). Fired triggers actioned: CPD `graceMargin` locked in as calibrated (~60 PRs, zero false trips → documented in `CPD_CAMPAIGN_AUDIT.md`); detailModals/deny ack-hygiene pair fixed (#1150).
- **Deferred prune** (user-approved): 8 deleted (incl. both ElevenLabs-canceled-era items), 3 relocated (2 feature ideas → icebox, TTS Budget Guard → BYOK Re-Eval theme). 113 → 101.
- **Icebox prune** (user-approved): all ~55 entries read; 7 deleted (headline: "Tag multiple bots" had SHIPPED months ago via MultiTagCoordinator), 4 merged into siblings, 2 rewritten to current reality (Reasoning/Thinking Modernization post-`__includeRawResponse`; GatewayClient-retry entry retargeted at the typed transport, which has `meta.idempotent` tags but NO retry layer). Verification saved 2 entries flagged for deletion (incognito mode is real in v3; release-notification side genuinely unbuilt).
- **Still actionable, not done tonight**: vision `maxAttempts` + `TIMEOUTS.VISION_MODEL` telemetry decisions (gates fired ~6 weeks ago — needs a Railway log-analysis pass); the 3 `TRIAGE-NEEDED` proposal triages (~45 min); `visionProvider` required-param check (needs a Railway warn-log query); Mistral slot-quota prod probe; PostToolUse-hook jq-path narrowing.

### Process notes

- **The tripwire dogfooded itself during its own PR** (no matches on its own files — correct) and its first real catch is pre-wired: the URL-guard follow-up entry in deferred.md references `check-deferred-refs.ts`, so editing the tool surfaces its own backlog.
- Review-loop convergence pattern was strong tonight: every PR's reviewer produced new smaller nits each round. Rounds 1-2 items were real (the `handleEditModal` sibling exposure catch on #1150 was legitimately in-scope and got fixed); rounds 3+ were dismissible with verification. The 08-review-response dismissal-with-verification discipline (e.g. "factually wrong: the stacked-@internal pattern IS used elsewhere") kept cycles bounded.

---

## Earlier Session — Quick-wins sweep: 3 PRs, queue cleared (2026-06-03)

Full sweep of the quick-wins backlog in three PRs, all merged to develop:

| PR    | Title                                                                     | Outcome                                                                                                                                                                               |
| ----- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1147 | `chore: remove dead redis dependency + depcruise test-factories boundary` | Dead `redis` dep dropped from 4 package.jsons + knip config; `no-prod-import-test-factories` depcruise rule (liveness-verified via synthetic violation); stale tsconfig entry retired |
| #1148 | `feat(tooling): add guard:dockerfile-dist`                                | New CI guard cross-checks Dockerfile runner-stage dist COPYs against the TRANSITIVE workspace dep closure — closes the PR #1145 crash-loop class; 23 tests; wired into lint job       |
| #1149 | `test+refactor(bot-client): view.ts coverage + typed preset pipeline`     | `handleExpandField` 5-branch + pagination-catch coverage; `unflattenPresetData` → `LlmConfigUpdateInput`; root-cause fix in common-types (see below)                                  |

### Net result

- **Quick-wins queue: empty** except one new entry the sweep itself generated (stacked-JSDoc merge in `check-duplicate-exports.ts`).
- **`optionalString()`/`nullableString()` typing wart fixed at the root** (#1149): both helpers were annotated as plain `z.ZodType<...>`, making every key REQUIRED in `z.infer`'d update-payload types — the reason `Parameters<>` casts existed at preset/persona/import call sites. Now `.optional()`-wrapped (runtime parse provably unchanged); 4 casts deleted across bot-client, with the `no-unnecessary-type-assertion` lint rule confirming each was dead.
- **`guard:dockerfile-dist`** (#1148): static check, no Docker build; flags missing AND stale runner-stage dist copies; transitive closure (not direct-deps) so `clients → common-types` chains resolve; voice-engine auto-skipped; documented in `05-tooling.md` (now "all five" guards).
- **Backlog deltas**: −6 quick-wins (3 shipped, 1 already-shipped stale, 2 absorbed), +1 quick-win (stacked JSDoc), +5 deferred (test-utils depcruise exemption, VALID_EFFORTS consolidation, expand-field config stub, orchestration multi-service coverage, runner-stage name anchoring).

### Process notes

- **Turbo cache poisoning found + worked around**: incremental `tsc` skipped emit while stale dist sat on disk (after cross-branch turbo cache restores), and turbo then cached that stale dist under the NEW source hash — every subsequent pre-push "restored" the poison. Fix was `rm -rf node_modules/.cache/turbo` + tsbuildinfo and a cold rebuild. If pre-push fails with type errors that don't reproduce under direct `tsc`, suspect this before anything else.
- **Silent push-transfer failures, twice**: pre-push hook printed success but the ref never updated at origin; `| tail`/`| grep` filters hid the missing `-> branch` line, and an armed CI Monitor watched a stale run. Auto-memory broadened: verify `git status -sb` in-sync after any push with filtered output.

**Active epic: Slim `@tzurot/common-types` (PR-2n)** — see [active-epic.md](backlog/active-epic.md). **Phase 1 shipped** (#1142): `factories/` → `@tzurot/test-factories` (dedicated package, NOT test-utils — that would close a `common-types ↔ test-utils` build cycle). Shipped to prod in beta.127.

**Next: Phase 2 — extract `common-types/services/`.** Design **SETTLED** (council GLM-5.1 + Kimi-K2.6 + Qwen-3.7-max, unanimous Hybrid): relocate single-consumer services to their owner, keep the 2+-consumer core in a small new shared package, split pub/sub publisher/subscriber pairs, evict the `prisma.ts` singleton (constructor-inject). **Sequencing DECIDED: `PR-2o → Phase 2.5 → PR-2p → PR-2q`** (optimized for no stopgaps — 2.5 makes bot-client Prisma-free before 2p evicts the singleton, so bot-client never needs a temporary local Prisma). **First code PR: PR-2o** (relocate single-consumer services — ai-worker resolver stack + `ConversationRetentionService` → api-gateway). ⚠️ **PR-2o must start by re-verifying the single-consumer set from VALUE imports** (exclude type-only, include tests) — the earlier Explore-agent consumption map was noisy (counted `import type { PersonaResolver }` as usage). Phase 3 (barrel-kill, ~1,021 sites) deferred to icebox. Full design + sequencing rationale in [active-epic.md](backlog/active-epic.md).

Quick-wins available between phases ([now.md](backlog/now.md)): queue swept 2026-06-03 — one item remains (stacked-JSDoc merge in `check-duplicate-exports.ts`).

**Candidate next themes after PR-2n** (user picks; each gets a council pass before plan-mode):

- **Self-Hosted TTS + BYOK Re-Eval — Step 0 BYOK probes** ([queue.md](backlog/cold/queue.md)) — Cartesia / Fish Audio / PlayHT / Resemble pricing-and-quality pass.
- **Adjacent CPD Follow-Up Campaigns** ([queue.md](backlog/cold/queue.md)) — four independently-pickable mini-epics from the 2026-05-16 CPD campaign close-out.

**Post-release loose ends**:

- **shapes import/export unverified** ([follow-ups.md](backlog/cold/follow-ups.md)) — the beta.126 dev smoke skipped the shapes.inc round-trip (needs a desktop Chrome session for the auth cookie). The timeout fix restored these routes to the `DEFERRED` budget (= beta.125), so confidence is high; verify next time at a desktop.
- **4 beta.126 review nits** ([now.md](backlog/now.md)) — optional doc/observability polish from PR #1120 claude-review.

**Verify on prod (low priority, fix shipped)**:

- Multi-personality ping race (shipped in PR #1049 / beta.123) — ping 2-3 personalities in quick succession with different prompts; each should reply with its own content. Re-add the production-issues entry only if the symptom resurfaces.
- `google/gemma-4-31b-it:free` is a real slug (confirmed 2026-05-19; verify guest-mode vision works in prod for paranoia).

---

## Previous Session — PR-2a: dual-mount + clientsFor + inspect PoC + burn-down gate (2026-05-27)

Phase 4 (PR-2) opening slice. Wires the codegen-generated mount functions into api-gateway alongside the legacy mounts, builds the `clientsFor(interaction)` boundary factory, migrates the first consumer (`commands/inspect`) as a proof of concept, and adds a `pnpm ops legacy:count` burn-down gate so subsequent migration PRs can't regress.

### PR merged

| PR    | Title                                                                 | Outcome                                                                                                                                                                                                                                                                                      |
| ----- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1102 | `feat(bot-client): dual-mount /api/* + migrate inspect to UserClient` | Dual-mount cutover, `clientsFor` factory, inspect migrated (4 callsites), burn-down gate with baseline + CI integration, structural turbo-cache fix for `structure.test` cross-package scan, 24 new unit tests including a URL-encoding sweep across all generated path-param client methods |

### Net result

- **api-gateway dual-mounts `/api/{internal,admin,user}/*`** alongside the legacy `/admin /user /internal` prefixes. Both serve traffic during the migration window. Wallet rate-limiter path-scoped to `/api/user/wallet/*` to preserve protection.
- **`clientsFor(interaction)` factory** in `bot-client/src/utils/gatewayClients.ts` — mints `ActorDiscordId` + `GatewayUser` exactly once per Discord interaction. Downstream handlers receive already-branded ServiceClient/OwnerClient/UserClient instances. Eliminates the missing-userId / wrong-fetcher / wrong-prefix footgun class at the type level.
- **`commands/inspect` migrated** as PoC — 4 callsites (3 in `lookup.ts`, 1 in `browse.ts`) cut over from `adminFetch` to `userClient.getDiagnosticBy*`. Diagnostic routes are on UserClient (not OwnerClient) since PR-1.5c lifted them to user audience with `acceptsSubject:true`. Tests rewritten from raw `fetch` mocking to typed stub clients (strictly cleaner).
- **`pnpm ops legacy:count` burn-down gate**: counts `adminFetch` + `callGatewayApi` references in `services/bot-client/src` (excluding tests). Baseline starts at `adminFetch=32, callGatewayApi=207`. CI fails if either count rises. Deleted (with baseline) once both reach zero. Wired into `pnpm quality` and the CI lint job.
- **Structural turbo-cache fix**: `structure.test.ts` in `@tzurot/common-types` scans all six packages' src dirs to enforce colocated tests, but turbo only invalidated common-types' test cache on common-types' OWN src changes — so missing tests in sibling packages slipped past local `pnpm test` (cached pass). Added a `@tzurot/common-types#test` turbo override that includes sibling `services/*/src/**` and `packages/*/src/**` as inputs. CI caught this exactly once in PR-2a; the structural fix prevents the class of failure from recurring.
- **URL-encoding sweep test** (`generated-encoding.test.ts`): 22 tests covering every path-param method across ServiceClient/OwnerClient/UserClient. Each invokes with a slash-containing input and asserts the fetch URL contains the encoded form (`%2F`). Locks the SSRF guard at the compiled-output layer, not just the codegen template.
- **10 review rounds, all converging clean**: 4 user-approved ASKs (existsSync guard, URL-encoding sweep breadth, turbo glob retention, lstatSync swap, readBaseline numeric guard + version validation); 3 trivial-shape auto-applies (JSDoc temporal-marker scrubs, dead-code `describeSource` cleanup, `BoundGatewayClients` eager-construction comment); 5 nits explicitly dismissed (test helper duplication, createdAt duplication, perf nits — all tracked in deferred.md where applicable).

### Backlog deltas

- `deferred.md`: 3 entries added
  - `normalizeDateTime(v: string | Date): string` extraction (promote when 3rd callsite appears)
  - `walkDirectory` TOCTOU on `lstatSync` (promote when real race surfaces or gate moves out of dev-tool)
  - Shared gateway-client stub helpers for bot-client tests (promote when 4th migrated command adds another consumer)
- `active-epic.md`: Phase 4 marked IN PROGRESS; PR-2a entry added under Phase 4 with all sub-deliverables enumerated.

### Process notes

- **Standing permission for routine git commit/push/PR-create cycles worked exactly as intended** — no asking, just executing on green tests/quality. 6 review rounds × 2 push cycles each (fixup + post-autosquash) all proceeded without per-cycle approval prompts. The user's intervention surface stayed focused on the substantive ASKs (5 of them), not the mechanical churn.
- **Reviewer reasoning sharpened across rounds**: round 7 dismissed `readBaseline` schema validation as "transitional tool nit"; round 9 reframed it as "NaN > 0 evaluates to false → gate passes silently on real regression" with a concrete failure case. The agent re-classified from Dismiss to Apply. Pattern worth keeping: when a reviewer escalates the same item with a sharper argument, that's new information, not ping-pong — re-evaluate.
- **Structural fix for "CI caught what local missed"**: the turbo cache override is the third instance of the agent updating the structural enforcement layer in response to a recurring failure mode (after `00-critical.md` "Fix Recurring Failures Structurally" rule). Memory alone wouldn't have prevented the next contributor from hitting it.

---

## Previous Session — PR-1.5d: PR #1097 follow-ups + epic retrofit (2026-05-26)

Closed three follow-up items from PR #1097's review cycle plus retrofitted the active-epic tracker after noticing 6+ PRs had shipped on a cohesive arc with no formal epic.

### PR merged

| PR    | Title                                                                        | Outcome                                                                                                                                                                                                                 |
| ----- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1098 | `fix(api-gateway): wire zod schemas + strong-type ResolveUserConfigDefaults` | Shapes-handler Zod bypass closed (3 handlers); ResolveUserConfigDefaults moved from passthrough to strongly-typed; compile-time collision guard added; backlog −3 entries; active-epic.md retrofitted with all 5 phases |

### Net result

- **Shapes-handler validation gap closed**: `import.ts`, `auth.ts`, `export.ts` switched from `req.body as {...}` casts to `parseBodyOrSendError(res, Schema, req.body)`. Direct API caller passing `importType: 'garbage'` now returns `VALIDATION_ERROR` instead of silently normalizing to `'full'`.
- **`.trim().min(1)` on all three shapes inputs** — rejects whitespace-only strings at the contract layer instead of falling through to downstream format validators. Error category now consistent (`VALIDATION_ERROR` across all three handlers).
- **`ResolveUserConfigDefaultsResponseSchema` strong-typed**: replaced `.passthrough()` with `ConfigOverridesSchema.required().extend({ sources, userOverrides })`. Generated client callers now see `{ maxMessages: number | null, voiceResponseMode: enum, ... }` at root instead of `{ [k: string]: unknown }`.
- **Compile-time collision guard**: `_ReservedKeysDoNotCollide` assertion proves `keyof ConfigOverrides` has empty intersection with `'sources' | 'userOverrides'`. Future field-name collision is now a compile error, not a runtime ambiguity.
- **Epic retrofit**: `backlog/active-epic.md` formalizes Route Manifest Scaffold + Typed-Client Codegen with all 5 phases (Manifest scaffold ✅, Handler refactor ✅, Coverage 🚧, Cutover ⏳, Cleanup ⏳) and the two open design decisions for PR-1.5e/1.5f.
- **6 review rounds**, all converging clean: 3 substantive items addressed + 3 micro-iterations (one nit dismissed in round 2 surfaced again in round 3 with stronger reasoning — applied then).

### Backlog deltas

- `quick-wins.md`: 3 entries removed
  - Shapes-handler Zod bypass (shipped in this PR)
  - `ResolveUserConfigDefaultsResponseSchema` collision-guard (shipped in this PR)
  - Stale `routeDeps.ts` scaffolding removal (handler refactor already wired the interface; structure.test exclusion is the right form)
- `active-epic.md`: replaced placeholder with full Route Manifest Scaffold epic
- Net: −3 entries, 0 added — matches the user directive that "newly added items should generally be tackled under subsequent work"

### Process notes

- The user noticed the missing epic mid-session — first time formalizing it after PR-1.0, PR-1.5a, PR-1.5b.2a #1093, PR-1.5b.2b #1094, PR-1.5c #1097 already shipped uncovered. Now traceable.
- Saved memory entry `feedback_council_models_for_design.md` capturing the user's preferred council lineup (GLM 5.1, Kimi K2.6, Qwen 3.7 Max) for the upcoming PR-1.5e/1.5f design decisions.

---

## Earlier — PR-1.5c: 36 missing user-route manifest entries (2026-05-26)

Marathon session shipping the PR-1.5 epic's largest single PR: filled in the 36 user-audience routes that had working server handlers but no manifest entries, so the route-manifest codegen now covers them.

### PR merged

| PR    | Title                                                                           | Outcome                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1097 | `feat(common-types): PR-1.5c — add manifest entries for 36 missing user routes` | Manifest 92 → 128 routes; resources.ts split into 6 sub-files; codegen learns required-vs-optional query param distinction; 4 schema bugs caught post-autosquash and fixed |

### Net result

- **Manifest coverage**: 128 routes (10 internal, 27 admin, 91 user) — ~75% of the user surface area now codegen-typed
- **File split**: routes/user/resources.ts (was 499 lines) → ownership.ts + resources.ts + memory.ts + config-overrides.ts + shapes.ts + diagnostics.ts (all under 400-line limit)
- **Codegen improvements**: `isOptionalZod` now correctly distinguishes `z.string()` (required) from `.optional()` / `.default()` (optional) — generated `client.getHistoryStats({ ... })` now refuses to omit required query params at compile time
- **4 schema bugs caught post-autosquash**: `listPersonaOverrides` wrong output schema, `ShapesImportJobSummary` non-nullable counts on `Int?` columns, `startShapesImport`/`startShapesExport` missing `input:` schemas, `setWalletKey` registered at `/wallet` instead of `/wallet/set`. Reading the post-autosquash review caught all four before merge
- **Dead code removed**: `types/schemas/historyApi.ts` (stale schemas missing `personaId`/`personaName`; zero consumers)
- **17 review rounds, 5,500+ diff lines, 36 routes** — heavy iteration but every concern resolved

### Backlog deltas

- `quick-wins.md`: 3 follow-up entries filed
  - Shapes-handler Zod bypass (input schemas decorative — handlers cast `req.body as {...}` manually)
  - Wallet rate-limiter cutover risk (`router.use(...)` middleware not emitted by codegen)
  - `ResolveUserConfigDefaultsResponseSchema` collision-guard + type-inference tightening
- `current-focus.md`: no changes (PR-1.5c was an opportunistic standalone PR, not part of a tracked epic)

### Deferred to PR-1.5d (or later)

- /user/memory main CRUD (~10 routes — dynamic-filter pattern needs design)
- /admin/diagnostic audience lift (5 routes — needs decision)

---

## Earlier Session — Quick-wins + auth symmetry sweep (2026-05-20)

Three-PR sweep: internal observability (`/admin metrics`), closing the last API Security Hardening item (`/voice-references` service auth), then a follow-up to eliminate the auth-posture asymmetry that surfaced during PR #1068 review.

### PRs merged

| PR    | Title                                                           | Outcome                                                                                          |
| ----- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| #1067 | `feat(bot-client): /admin metrics command`                      | Bot-owner-only slash command renders queue/cache/uptime metrics in an ephemeral embed            |
| #1068 | `fix(api-gateway): protect /voice-references with service auth` | Slug-enumeration attack surface closed; ai-worker now gates startup on `INTERNAL_SERVICE_SECRET` |
| #1069 | `fix: symmetric INTERNAL_SERVICE_SECRET startup validation`     | api-gateway warn → throw; bot-client gains startup check matching ai-worker (#1068)              |

### Net result

- **API Security Hardening theme fully closed.** All three items shipped (rate limiter #1046, helmet/CORS #1046/#1048, voice-references service auth #1068). Theme section removed from `future-themes.md`.
- **Defense-in-depth on auth misconfig**: ai-worker now validates `INTERNAL_SERVICE_SECRET` at process startup (`validateRequiredEnvVars`) AND at call-site in `voiceReferenceHelper` — misconfig fails the boot instead of silently degrading TTS.
- **Symmetric auth posture across services**: api-gateway, bot-client, and ai-worker all refuse to boot without `INTERNAL_SERVICE_SECRET`. Identical error messages across services make log-grep trivial during incident triage.
- **Internal observability surface added**: `/admin metrics` slash command mirrors the existing `/admin health` pattern.

### Backlog deltas

- `current-focus.md`: voice-references enumeration item removed (shipped via #1068)
- `quick-wins.md`: `/admin metrics` entry removed (shipped via #1067)
- `icebox.md`: rate-limit voice-references item removed (concern moot now that route requires service auth)
- `future-themes.md`: API Security Hardening theme section removed entirely
- `next-theme.md`: API Security Hardening dropped from candidates list

### Backlog state at session close

- **Production issues**: 0 active
- **Inbox**: empty
- **Current focus**: empty (open-pick next session)
- **Quick wins**: 0 active
- **Active epic**: none
- **Deferred**: 89 trigger-gated items
- **Future themes**: 22 queued (API Security Hardening removed)

---

## This Morning — Post-release polish (2026-05-21)

Closed the 3 inbox items filed during the v3.0.0-beta.124 release-cycle reviews. One bundled PR:

| PR    | Outcome                                                                                                                                                                                        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1073 | GatewayClient timeouts → named `TIMEOUTS.*` (3 new constants); `?? ''` fallback → `getValidatedServiceSecret()` helper (10 sites); `/admin metrics` single-dispatch refactor + regression test |

Net result: bot-client/utils is internally consistent, no more inline magic numbers for timeouts, no silent-401 risk from empty service-auth headers, no wrong-attribution failure mode on `/admin metrics` non-OK responses. Backlog inbox cleared.

These will ship in beta.125 whenever it's cut; no release cadence pressure.

---

## Prior Session — MultiTagRecovery hardening chain (2026-05-19, evening)

Five PRs shipped in sequence, each addressing a distinct layer of the multi-tag rehydration problem first surfaced by the beta.123 deploy incident at 05:16 UTC.

### PRs merged

| PR    | Title                                                                    | Layer addressed                                                                                                                            |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| #1062 | `fix(bot-client): render personality voice on safety-timeout errors`     | UX symptom — persona-voice fallback when safety timeout fires (pre-evening, captured for context)                                          |
| #1063 | `fix(bot-client): poll BullMQ job state on MultiTagRecovery rehydration` | Root cause — recover original results instead of resubmitting at restart; symmetric `saveAssistantMessage` try/catch                       |
| #1064 | `fix(bot-client): resolve real persona UUID at MultiTagRecovery time`    | FK violation closed — `PersonaResolver` cascade replaces synthetic `recovery-persona-*` strings; conversation history persists correctly   |
| #1065 | `fix(bot-client): close 4 MultiTagRecovery follow-ups from #1063/#1064`  | Defense-in-depth + perf — returnvalue shape guard, per-delivery try/catch, `Promise.all` parallelize, `resolvePersonaIdOnly` cheaper query |
| #1066 | `fix(bot-client): route multi-tag live-failure events via coordinator`   | Live failure routing — `JobFailureListener` now synthesizes failure + calls `handleJobResult` for multi-tag jobIds (no more 10-min wait)   |

### Net result

The multi-tag fan-out path is substantially more resilient:

- **Restart recovery**: original responses preserved (no resubmission); per-slot latency roughly halved via `Promise.all`
- **Live failures**: routed to user within seconds, not 10 minutes (synthesized failure result via coordinator path)
- **Conversation history**: persists correctly for recovered messages (real persona UUID instead of synthetic FK violation)
- **Defense-in-depth**: returnvalue shape validation, per-delivery error handling, belt-and-suspenders `saveAssistantMessage` try/catch

### Backlog deltas

- `inbox.md` cleared (live-failure listener shipped via #1066)
- `current-focus.md` cleared (rehydration follow-up chain fully shipped)
- `deferred.md`: 2 trigger-gated items remain from the chain (idempotent re-dispatch, synthesized-failure `personalityErrorMessage`)
- Three memory updates: temporal-marker patterns extended (`extracted from X`, `This is the primary fix`), Steam Deck pre-push flake reference added

### Backlog state at session close

- **Production issues**: 0 active
- **Inbox**: empty
- **Current focus**: empty (open-pick next session)
- **Quick wins**: 1 active (`/admin metrics`)
- **Active epic**: none
- **Deferred**: 89 trigger-gated items (+2 from this chain)
- **Future themes**: 23 queued

---

## Prior Session — v3.0.0-beta.123 release + PR #1062 fast-follow + backlog cleanup (2026-05-18 → 2026-05-19)

Marathon sweep cycle: started with intake from a personal-notes review of recent UX issues, shipped 10 PRs into the beta.123 release, then a post-release fast-follow PR and a backlog hygiene pass.

### PRs merged this cycle

| PR    | Title                                                                          | Domain                    |
| ----- | ------------------------------------------------------------------------------ | ------------------------- |
| #1051 | `chore(api-gateway): /metrics housekeeping`                                    | Internal API auth         |
| #1052 | `fix(ai-worker): bound voice-engine STT retry loop`                            | Voice STT                 |
| #1053 | `fix(bot-client): unblock channel queue when AI job fails`                     | Multi-personality routing |
| #1054 | `chore(deps): bump production-dependencies` (×7)                               | Deps                      |
| #1055 | `chore(deps-dev): bump development-dependencies` (×14) + knip 6.14.1 fallout   | Deps + ci hook            |
| #1056 | `fix: cross-channel history ordering + voice transcript tagging`               | Conversation context      |
| #1057 | `fix(ai-worker): cache header-less 429s + bump free gemma constant`            | LLM provider              |
| #1058 | `fix(bot-client): activation slot on forwarded messages`                       | Discord routing           |
| #1059 | `chore(bot-client): polish /admin db-sync embed truncation`                    | Admin UX                  |
| #1060 | `v3.0.0-beta.123` (release PR, develop → main)                                 | Release                   |
| #1062 | `fix(bot-client): render personality voice on multi-tag safety-timeout errors` | Post-release follow-up    |

Plus PR #1049 (per-result `deliverFn` for multi-personality race) which landed on develop earlier and shipped in this release.

### Post-release: production failure surfaced + diagnosed + partial-fix shipped

Within minutes of beta.123 deploy, a user-visible error appeared in Discord ("Sorry, I encountered an error..."). Railway logs revealed the failure mode:

- Old bot-client SIGTERM'd cleanly at 05:16:15 UTC
- Old ai-worker completed the in-flight job 17s LATER (05:16:32 UTC) — result published to BullMQ with no consumer listening
- New bot-client rehydrated coordinator entry but `QueueEvents` is a stream subscription that doesn't replay events emitted before the listener attached
- 10 min later `MultiTagCoordinator.handleSafetyTimeout` fired → generic bot error in Discord

**PR #1062** addresses the user-facing symptom (in-character voice on safety-timeout instead of generic bot fallback). **The structural fix** (poll BullMQ job state at rehydration to backfill missed completion events) is now the next-session active focus, since it's reproducible on every deploy with in-flight jobs.

### Backlog hygiene pass

- **production-issues.md**: ping-race entry retired (shipped in PR #1049). No active production issues.
- **active-epic.md**: TTS Engine Upgrade closed — Phase 1 + Phase 3 shipped, Phase 2 abandoned with replacement work tracked in the "Self-Hosted TTS + BYOK Re-Evaluation" theme. File stripped to a closure stub.
- **API Security Hardening theme**: items 1 (rate limiter, PR #1046) + 2 (helmet/CORS, PR #1046/#1048) already shipped; theme retitled to reflect that only the voice-reference slug-enumeration item remains.
- **deferred.md**: +1 entry (personality-voice for completed-but-empty slots, from PR #1062 round-3 review).

### Backlog state at session close

- **Production issues**: 0 active
- **Inbox**: empty (last swept 2026-05-19)
- **Current focus**: 1 active (rehydration poll)
- **Quick wins**: 2 items (`/admin metrics`, retry-on-inadequate-LLM-response)
- **Active epic**: none — pick from next-theme candidates
- **Deferred**: 87 trigger-gated items
- **Future themes**: 23 queued

---

## Migrations Applied (v3.0.0-beta.120)

All three migration waves were applied to dev + prod during the previous development cycle:

- `add_stt_provider_columns` (#1005, additive)
- `drop_unused_voice_provider_columns` (#1007)
- `add_stt_provider_check_constraint` (#1008)

No new migrations in v3.0.0-beta.121, beta.122, beta.123, or develop since.
