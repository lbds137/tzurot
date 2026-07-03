# Current

> **Version**: v3.0.0-beta.146 (released 2026-07-03) — **no migrations**. Headliners: **finish_reason-"error" retryable fix** (#1462 — provider death inside an HTTP 200 no longer delivers garbage or poisons LTM), **both-fail route-chain footer** (#1456 + #1460 — closes the z.ai confusion family), **the Stryker pilot arc** (#1459/#1461/#1463 — config-resolver mutation-score ratchet at baseline 87.81, parallel `mutation-tests` CI job; suite-wide expansion still open), **human-users-only auth invariant** (#1464), **ops logs incident-dig flags** (#1465), **ops:health aggregator + weekly audit cron** (#1466 — cron LIVE from main, Saturdays 09:00 UTC; maiden dispatch ✅ OK with Discord thread delivery proven; webhook secret set). **3 themes CLOSED** (human-users-only, railway-log-DX, periodic-audit). 11 PRs; release review: "nothing survived verification as an actionable bug." _Prior: v3.0.0-beta.145 (2026-07-02) — TTS pointers, lifecycle handling, backlog shrink, guard:workflow-sync (14 PRs)._

---

## Unreleased on Develop (since beta.146)

**Released v3.0.0-beta.146 on 2026-07-03** (notes: [tag v3.0.0-beta.146](https://github.com/lbds137/tzurot/releases/tag/v3.0.0-beta.146)). `release:finalize` SHA-aligned develop with main — **nothing unreleased on develop.**

**beta.146 post-release state**: weekly audit cron verified end-to-end via manual `workflow_dispatch` (run green, report ✅ OK across the 5-tool roster, Discord thread delivery via `?thread_id=` webhook confirmed — the purple cube posts). First scheduled run: Saturday 2026-07-04 09:00 UTC. One carried watch-item from beta.145: **vision error-pattern recall** (an error phrased outside the new anchors would positive-cache for 1h — promote-when row in `cold/follow-ups.md`).

---

## Next Session Goal

**IN FLIGHT: the pre-handoff process refit** (Fable access ends 2026-07-07 → Opus). Done: friction mining (six weeks of transcripts, reports archived at `~/.claude/projects/-home-deck-Projects-tzurot/mined-corpus/` incl. SYNTHESIS.md — the spec for everything below), rules/skills refit PR #1468 MERGED, memory store 56→26, old session JSONLs purged (corpus archived). Remaining, tracked in the session task list + synthesis Parts 4–8:

1. **Docs purge + backlog hygiene** (Phase D) — deletion scout dispatched; purge PR next (superseded memory-design docs ~4,500 lines, dead links, philosophy reconciliation, postmortem compression to incident→operationalization shape).
2. **Anti-re-bloat tooling** — line-count ratchet on `.claude/rules/` + CURRENT.md (house baseline-and-hold pattern), docs-orphan scan in the weekly audit.
3. **CURRENT.md session-log cap is now policy**: current-state + last 2 session retrospectives, older ones deleted at session end (git preserves — this file was 662 lines; it's now ~35).

After the refit lands, **finishing-first resumes** (ordering in `active-epic.md`): job-payload contract suite · CPD campaign 1 (council-first) · Stryker per-package expansion · LLM legacy-column Phase A DROP (destructive; `release:premigrate --allow-destructive`).

Passive check: did the Saturday 2026-07-04 09:00 UTC scheduled audit run fire on its own (dispatch test proved the pipeline; the cron trigger gets its first exercise then).

## Last Session — beta.146 knockout + finishing push (2026-07-02 → 07-03)

**11 PRs merged (#1456–#1466), 3 themes CLOSED, 2 prod bugs fixed same-day.** The z.ai "routing bug" was diagnosed as fallback-visibility (one seam, two symptoms) → both-fail footer chain #1456 + summary-unwrap #1460. The Stryker pilot arc shipped (config-resolver only — per-package expansion remains open in the theme): pilot #1459 (60.71% score against green line coverage — premise validated), 23 gap-closing tests #1461 (→77.74%, logic classes 97.2%), logger-ignorer ratchet #1463 (baseline-and-hold 87.81, full audit-class ceremony, parallel `mutation-tests` CI job ~3min). The finish_reason-"error" prod bug (OpenRouter provider failure inside HTTP 200 → 1-char reply delivered + LTM poisoned) went screenshot→investigation→fix→merged in ~90min (#1462; stable thrown message for classification safety, provider detail preserved via `response_metadata.openrouter.providerError`). Then the **finishing push** (user: "I definitely like finishing stuff" → memory `finish-partial-themes-first`): human-users-only invariant #1464 (the prior bot-block was structurally UNREACHABLE — flag never passed; now compile-enforced from `GatewayUser.isBot` through `X-User-Is-Bot` to `requireUserAuth`), ops logs incident-dig flags #1465 (pull-and-grep-locally, NOT the unreliable server DSL; review caught a real CAC numeric auto-coercion silent-drop on all-digit IDs — empirically confirmed before fixing), ops:health aggregator + weekly cron #1466 (Layers 5–6; maiden run surfaced 2 perma-red roster candidates → excluded with tuning rows, per "false positives are a death spiral"). Review-cycle note: #1465/#1466 each ran 4–5 converging rounds with genuinely real catches (CAC coercion, verdict-header truncation, roster-rot guard, diagnostic fall-through); the round-cap ASK fired twice — user chose fix-then-merge both times. Also: 402 max_tokens auto-reduction evaluated + DECLINED (input tokens dominate this bot's spend); first-ever claude-review run that completed without posting (re-run posted normally — watch for recurrence).

## Last Session — the beta.144 mega-session (2026-07-01 → 07-02)

Epic close → bug blitz → perf forensics → backlog sweep → release. **13 PRs merged** (#1429–#1440 + release #1439). Highlights: Phase 4 C2b shipped after 5 review rounds (each caught a real bug → drove the wiring/seam-test pattern + the assert-at-seam rule #1430); the 20s personality-load stall was forensically traced (prod DB reads + log pulls) to the connection layer — **data volume ruled out** (DB = 422MB total) — yielding the main-pool hardening; a backlog sweep (agent-driven triage of ~298 cold items) found only 1 obsolete entry (the backlog is real, not rot) and clustered ~19 closeable rows; the gateway's 3.5h zombie outage was diagnosed (unguarded shutdown re-entry loop, 57M dropped log lines) and fixed in-release. Review-cycle discipline note: reviewers caught two wiring gaps in my own compound-error PR (category flip via message-regex classification; log-only field never reaching Discord) — the seam-testing rule works both ways.
