## Now

_The hot surface — loaded at session start alongside `BACKLOG.md`, `active-epic.md`, `references.md`. Keep it small. Caps: Current Focus ≤ 3, Quick Wins ≤ 5, Untriaged ≤ 10._

---

### 🚨 Production Issues

_Active bugs observed in production. Fix before new features. Cleared issues are removed once released — see git history + the GitHub release notes._

**🐛 `[FIX]` Gateway user-message persist hangs ~20s → user sees "something's slow on our end"** — Surfaced 2026-06-25 (user prod screenshot). bot-client's synchronous `persistUserMessageViaGateway` (POST `/internal/conversation/user-message`) times out at the ~20s WRITE budget; when it's the only summoned slot, `MultiTagCoordinator` emits the "⏳ Couldn't get a response just now…" notice and the user gets NO AI response. **Runtime-confirmed twice today** (13:42:03Z + 18:37:44Z UTC; bot-client error `User-message persist failed via gateway: 0 Request timeout`). Gateway side (req 896): `request aborted, responseTime=19997, statusCode:null` — the single `conversationHistory` INSERT (`ConversationHistoryService.addMessage`) blocked ~20s while the 6 context-read requests in the SAME interaction each completed in <60ms. Gateway up since 04:34Z (no restart), single replica, NO pool-saturation / acquisition-timeout / `[ERROR]` log. **Dig-deeper (2026-06-25) ruled OUT**: (a) pool starvation — 10s acquisition timeout never fired; (b) broad DB/I-O stall — every OTHER request in the 18:35–39 window (reads + the NSFW-verify write) returned in <71ms; (c) legacy dual-write race — bot-client `saveUserMessage` now routes through the gateway (no direct Prisma), so the handler's P2002 fallback + "dual-write window" doc are STALE (cleanup candidate); (d) retention cleanup — admin-only (`/admin/cleanup`), NOT scheduled, no retention activity near either incident. **So it's a block SPECIFIC to the `conversationHistory` INSERT, not systemic.** Three live, un-disambiguated hypotheses (not resolvable from retained logs): **(1) a lock wait** (the exact ~20s-twice = waits-until-client-abort signature favors this, but no holder found — only unique key is the PK, no concurrent same-id writer); **(2) GIN-index pending-list flush** — `messageMetadata` has a `fastupdate`-default-ON GIN index (`conversation_history_message_metadata_idx`); one unlucky INSERT pays the whole pending-list merge, which is table-specific + intermittent; **(3) a dead/stale pooled connection** — query sent to a broken socket hangs until client abort (also fits exact-20s + intermittent). **Aggravating factor**: NO `statement_timeout`/`lock_timeout`/client `query_timeout` anywhere → any of the three hangs silently to the ~20s client abort. **Mitigation implemented (beta.138)**: council pass (GLM-5.2 + Qwen-3.7) → a dedicated **fast pool** for the two conversation-event persist routes ONLY (main pool untouched → legit long ops exempt by architecture), with a staggered `lock_timeout`(2s) < `statement_timeout`(5s) < client `query_timeout`(6s) ladder, a boot `SHOW` probe that fails fast if the GUC `options` startup string didn't apply, and a SQLSTATE classifier that **self-labels** the cause. **Runtime-verified on dev**: GUCs apply through `@prisma/adapter-pg`; `statement_timeout` fired on `pg_sleep(7)` at 5042ms; classifier → `{statement-timeout, 57014}`. Bounds the hang to ~6s (the user sees the notice fast instead of after 20s) AND labels the next occurrence. **Promote-when (root-cause, still open)**: when a `lock-timeout` / `statement-timeout` / `query-timeout-or-dead-conn` label appears in prod logs, do the targeted fix — lock → find the `FOR UPDATE`/DELETE holder on Persona/Personality (the FK-parent `FOR KEY SHARE` surface); slow-work → GIN `fastupdate=off` + scheduled `gin_clean_pending_list`; dead-conn → `idleTimeoutMillis` tuning. _Logs: `scratchpad/gw-prod.txt`._

_Recently resolved:_ the DB connection-pool-starvation timeouts (surfaced 2026-06-11, fixed 2026-06-18 via #1250/#1251 — bounded `pg.Pool` `max=20` + 10s acquisition timeout + saturation gauge) were **confirmed resolved 2026-06-25** (prod logs: both pools configured, zero saturation). NOTE: this new issue is a DIFFERENT failure mode (a single INSERT blocking with the pool healthy), not a pool-starvation regression.

---

### 🎯 Current Focus (max 3)

1. **Test-Pyramid Taxonomy + Coverage Audit — active epic** (see [`active-epic.md`](active-epic.md)). Shipped: Phase 1 (#1284), Phase 1.5 (#1285), **suffix rename (#1339)**, **golden-fixture envelope contract + topology skeleton (#1340)**, **Phase 2a — code-derived topology generator (#1341)**, and **Phase 2b — mechanism-PRESENCE verification + `topology:check` lockfile-diff CI gate (#1342)** (probes each surface's mechanism on disk; committed `coverage-topology.json` byte-compared in `pnpm quality` + CI; 154 surfaces, 0 gaps). **Phase 2 COMPLETE. Next: the `test:tier-audit` ratchet** (Phase 4 / enforcement bulk — audit-class, _fails_ CI on a missing required tier, building on this topology) + the Phase 3 gap-fill remainder (ContextAssembler component tests, weigh-in assembly). **Then the consolidated grab-bag cleanup PR** (per user): the #1339/#1340/#1342 non-blocking review nits (see `active-epic.md` › Epic grab-bag).

---

### ⚡ Quick Wins (max 5)

_Small tasks that can be done between major features. Good for momentum._

_(empty)_

---

### 📥 Untriaged (max 10)

_New items land here for same-session capture. Route each to its home — `cold/follow-ups.md` (terse, one-liner), `cold/ideas.md` (speculative feature), `cold/themes/` (multi-phase epic), or Current Focus / Quick Wins — when you get to it. An empty Untriaged is the goal._

_(empty)_
