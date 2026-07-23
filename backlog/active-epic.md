## 🏗 Active Epic: Automated Inactivity Retention & Purge

_Focus: a non-commercial solo-operator bot should not retain per-user data (conversations, memories, facts, user-created personas/characters, usage logs) indefinitely for people who stopped using it. Ship an automated retention/purge mechanism keyed on inactivity + unreachability. Promoted 2026-07-23 (owner: "I'm not a commercial entity that can retain user data indefinitely for people who haven't touched the bot in over 3 months"); triggered by beta.174's blast surfacing 26 `50278`-undeliverable users. **Temporarily displaces the UX epic** (parked below) until this ships, then UX standardization resumes._

**Design ACCEPTED 2026-07-23** (owner + council trio GLM 5.2 · Kimi K2.7-code · Qwen 3.7 Max) → [`docs/proposals/backlog/inactivity-retention-purge.md`](../docs/proposals/backlog/inactivity-retention-purge.md). Key locked decisions: **single 180-day window** (not flat-90d — council: too aggressive for user-created content); **`lastActiveAt`** stamped on any interaction + **backfilled from history** (not ship-time — kills the zombie cohort); **undeliverable = `50278`+`50007`, never `20026`** (bot-wide quarantine would false-flag everyone — blast-radius safety); **circuit breaker** (halt+page on a >X% mass-flag run); **manual-approval-first** → autonomous-with-breaker later; privacy-policy entry.

### Roadmap (per the proposal's phasing)

| Phase | Contents | Status |
| --- | --- | --- |
| 1 — tracking | schema (`lastActiveAt`, `dmUndeliverableSince`) + migration + historical backfill; central activity stamp (gateway enrichment + bot-client touch); undeliverable stamp on 50278/50007 in the DM-failure path; clear-on-reach. No purge yet — just start the clock. | NEXT |
| 2 — preview + unreachable purge | `pnpm ops retention:preview` (dry-run) + the daily job's unreachable branch behind manual approval. The 26 = first real preview batch at their backfilled ship+180d. | pending Phase 1 |
| 3 — reachable branch | notify + `AccountExportJob` offer + grace + notify-send-failure re-route; circuit breaker. Verify `AccountExportJob` delivery path (25MB DM cap / link expiry) first. | pending Phase 2 |
| 4 — policy + autonomous | privacy-policy 180-day-window entry; flip to autonomous-with-circuit-breaker once trusted. | pending Phase 3 |

**Ride-along Quick Win** (sibling class): `dmErrorClassifier` gains the `bot_level` class for `20026` (filed in `now.md`) — the classifier side of the same "20026 isn't the user's fault" ruling.

---

## ⏸ Parked next-up: Platform-Portable UX Layer (Discord Design System) — resume after retention

_The beta-exit gate (owner 2026-07-17). PARKED mid-Phase-3 on 2026-07-23 to let the retention epic through; resumes as the immediate next epic. Full roadmap + pilot + owner-design-inputs preserved in this file's git history (pre-2026-07-23); authoritative detail in the two ACCEPTED artifacts + the per-PR log._

- **Phase 1 (catalog + voice)** ✅ COMPLETE (beta ≤172). **Phase 2 (components)** ✅ COMPLETE (beta.170–172). **Phase 3 (vocabulary + enforcement)** IN FLIGHT — **Waves 0–3 ✅ RELEASED** (beta.173 waves 0–2; **beta.174 wave 3, the breaking rename batch**). **Remaining: Waves 4–6** — PR-6a factory core+pilot → 6b destructive preset → 7 `/deny` redesign → 8 remaining picker hygiene → 9/10 factory sweep + router adoption (normal minors). Phase 4 (adapter) trigger-gated on a real second platform.
- Artifacts: [`docs/proposals/backlog/ux-design-system-spec.md`](../docs/proposals/backlog/ux-design-system-spec.md) (WHAT) · [`docs/proposals/backlog/platform-portable-ux-design.md`](../docs/proposals/backlog/platform-portable-ux-design.md) (HOW) · plan file `~/.claude/plans/radiant-tickling-candle.md` · per-PR detail [`cold/epic-log.md`](cold/epic-log.md).
- Phase-1 follow-ups + the alias-redesign pilot + scoping-tier design inputs: preserved in git history of this file + `cold/follow-ups.md`.
