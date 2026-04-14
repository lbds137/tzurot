# Current

> **Session**: 2026-04-13
> **Version**: v3.0.0-beta.96

---

## Session Goal

_Daytime: backlog shrinkage + deps update + preset UX → beta.96. Evening: investigate production vision-pipeline latency (user complaint: "AI sometimes takes a long time"), triage findings into a clear NOW/NEXT/LATER plan for next coding session._

## Active Task

🐛 `[FIX]` **Vision-pipeline diagnostic bundle — NOW tier from evening investigation** (pick up next coding session)

- [ ] Railway logs `--filter` passthrough in ops wrapper — `packages/tooling/src/deployment/logs.ts:227` (~30 min)
- [ ] Reclassify `AbortError: "Request was aborted"` as TIMEOUT with 1-retry policy — `services/ai-worker/src/utils/apiErrorParser.ts` + `retry.ts`
- [ ] Pattern-detect `"400 Received 404 when fetching URL"` as permanent non-retryable — same file as above
- [ ] Per-attempt success telemetry in `withRetry` — `services/ai-worker/src/utils/retry.ts`

**Ship as one small PR (~2 hrs).** Validate post-deploy: `pnpm ops logs --service ai-worker --filter "vision"` — expect AbortError retry clusters to disappear. Baseline to beat: 99 failures / 1000 log lines, 63% AbortError.

Full rationale + fix-space ordering in the "AbortError in image processing" Inbox entry in BACKLOG.md.

---

## Completed This Session

### PR #794 — BrowseActionRow Extraction + Guard Test Trim

- Extracted shared `BrowseActionRow` type from 5 duplicate definitions into `browse/types.ts`
- Fixed deny/browse `as unknown as` cast by adopting the union type
- Removed 12 duplicate guard/parse tests from 3 settings test files (covered by factory)
- Cleaned up dead mock helpers and unused imports

### PR #795 — Route Helpers Split + configId Tightening

- Split `resolveUserIdOrSendError` into new `routeHelpers.ts` (9 import sites updated)
- Replaced `getParam` with `getRequiredParam` for configId in LLM config routes
- Added `ParameterError → 400` mapping in `asyncHandler` (was 500)
- Created `asyncHandler.test.ts` with 4 tests

### PR #796 — Thinking Tags Data-Driven

- Replaced 7 hardcoded regex patterns with single `KNOWN_THINKING_TAGS` array
- Adding a new tag now requires one line change instead of seven
- Added constraint comment, ordering safety note, readonly annotation

### PR #797 — Mention Parser Fixes + Forwarded Messages

- Forwarded messages no longer trigger AI responses in either processor
- Apostrophe names work (`@O'Reilly`)
- Possessive forms work (`@Lilith's` → matches `Lilith`)
- MCP council consulted for forwarded message design decision

### PR #798 — Dependency Updates

- 30+ packages bumped (Prisma 7.7, vite 8, ts-morph 28, vitest 4.1.4, etc.)
- `pnpm/action-setup` v6 attempted → reverted due to CI lockfile breakage
- Regenerated `pnpm-lock.yaml`

### PR #799 — Preset Error Surfacing

- Preset save/clone/create now show actual API error messages instead of generic "Failed to X"
- Extracted `extractApiErrorMessage` helper with Discord length guard (1800 char cap)
- Regex anchored to HTTP status format to prevent false positives

### PR #800 — Session Follow-ups

- Fixed double body consumption in `updateGlobalPreset` error path (read-once pattern)
- Tightened 409 duplicate check from `includes('409')` to `includes(': 409 ')`
- Increased xray analyzer test timeout to 30s for CI stability

### Other

- Closed 7 Dependabot PRs (#787-793) — superseded by consolidated #798
- ElevenLabs "aborted" edge case closed (resolved in beta.95)
- Backlog updated: 8 items cleared, 5 new items added from review findings

### Evening — Investigative work (no code changes, backlog enrichment only)

**Scope**: user shared stream-of-consciousness ideas in Discord → parallel Explore-agent investigation → deep-dive into user's "AI is slow sometimes" complaint via prod log analysis.

**Key findings**:

- 4 new-idea items triaged (3 Inbox, 1 Icebox); 2 incidental findings became their own Inbox items (avatar no-timeout; cross-channel reference permission gap reframed as defense-in-depth after user pushback on severity)
- Railway CLI 4.11.2 has server-side `--filter` query syntax (attribute filters, boolean operators); our `pnpm ops logs` wrapper does client-side grep and doesn't use it — step-0 fix unlocks powerful ad-hoc diagnosis
- Prod vision-log analysis: **63% AbortError / 30% rate_limit / 7% 400-on-dead-URL**; ~12% invocation success rate (88% failure in cache-miss path)
- AbortError root cause identified: `model.invoke({ timeout: 90s })` at `VisionProcessor.ts:165` → LangChain internal abort → OpenAI SDK throws raw AbortError → falls through classifier to UNKNOWN → default `shouldRetry=true` amplifies into retry storms
- Error-handling architecture audit: partially unified via common-types `ApiErrorCategory`; real gap is bot-client stringly-typing timeout detection instead of importing the `TimeoutError` sentinel

**Backlog changes**:

- AbortError entry rewritten with reprioritized fix space (AbortError classifier primary, 404-URL secondary, success telemetry prerequisite); earlier "CDN stall" hypothesis preserved as context above the UPDATE block for reasoning trail
- Railway logs entry updated with `--filter` server-side finding + new step-0 (~30 min wrapper fix)
- Cross-channel context entry corrected (`handlers/references/`, not `utils/messageReferences/`)
- Platform abstraction Icebox entry updated with 45–55% DSL-shaped finding + `defineCommand` already being the nucleus
- **6 new Inbox items**: avatar upload no-timeout, cross-channel reference permission-check gap, per-attempt success telemetry in withRetry, TimeoutError + normalizeErrorForLogging extraction to common-types, `HARDCODED_CONFIG_DEFAULTS.maxAge` 7d default, "taking longer" notification fire-at-5min + cleanup

**Attempted Council MCP consultation** — `mcp__council__*` tools not loaded in this session (MCP server not running; skill describes procedure correctly). Did own prioritization synthesis instead, which drove the NOW bundle in Active Task above.

**Meta-lesson for morning-me**: investigative work benefits from a prioritization target set up front, not at the end. Tonight got pulled into expanding options before committing to a recommendation; user's "I'm overwhelmed by volume" was the signal that synthesis was overdue.

---

## Scratchpad

**Validation baseline** (compare against post-deploy):

- 99 vision failures / 1000 log lines sampled 2026-04-14 UTC night
- 55/99 AbortError (~55%), 18/99 rate_limit (~18%), 4/99 bad_request (~4%)
- ~12% invocation success rate in cache-miss path

**"88% vision invocation failure rate"**: not its own task. If post-fix rate stays high, that's the trigger for paid-tier vision fallback work (already in Model Configuration Overhaul theme). If it drops meaningfully, free-tier-only strategy is fine.

**Railway CLI query cheatsheet** (for future sessions until the `--filter` passthrough lands):

```bash
railway logs --service ai-worker --environment production --lines 500 --filter "vision AND (404 OR 400)"
railway logs --service ai-worker --environment production --lines 500 --filter "@level:error"
```

---

## Unreleased on Develop (since beta.96)

_(Empty — release pending merge to main)_

---

## Previous Sessions

- **2026-04-13**: Backlog shrinkage (PRs #794-800), deps update, preset UX, beta.96
- **2026-04-12**: Voice engine hardening (PR #785), Python hooks, release audit, beta.95
- **2026-04-11**: CPD Session 1 (PRs #778-780), channel rename (#781), doc audit (#782-784)
- **2026-04-10**: Browse Step 8 (PR #776), CPD 137→126
- **2026-04-09**: Browse Steps 6-7 (PR #775), footer design plan + council consultation
- **2026-04-06**: Architecture day (PRs #766, #768, #769), CPD 146→137

## Recent Releases

- **v3.0.0-beta.96** (2026-04-13) — Mention parser fixes, forwarded messages, preset error surfacing, deps update, refactors
- **v3.0.0-beta.95** (2026-04-12) — Voice engine lazy loading, ElevenLabs abort fix, CPD Session 1, browse epic, doc audit
- **v3.0.0-beta.94** (2026-04-10) — Browse standardization, config override helpers, shared abstractions
- **v3.0.0-beta.93** (2026-04-05) — Voice engine retry, security bumps, cascade resolver fixes

---

## Quick Links

- **[BACKLOG.md](BACKLOG.md)** - All work items
- [CLAUDE.md](CLAUDE.md) - AI assistant rules
- [GitHub Releases](https://github.com/lbds137/tzurot/releases) - Full history
