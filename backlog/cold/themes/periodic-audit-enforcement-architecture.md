### Theme: Periodic Audit Enforcement Architecture

_Focus: ensure the ~7 ops commands + 2 slash skills documented as "run periodically" actually get run — without a system that itself rots or becomes notification spam._

**Full proposal**: [`docs/proposals/backlog/periodic-audit-enforcement.md`](../docs/proposals/backlog/periodic-audit-enforcement.md). Synthesized from a 4-model council pass (Gemini 3.1 Pro → GLM 5.1 → Kimi K2.6 → Opus 4.7) on 2026-05-22.

**Phases:**

1. **Layer 1 — Canary + golden fixture for 2 least-trusted tools.** ~2 days, runs in regular CI (not cron), foundational because everything else depends on the audits actually working. Build this first; survives even if the rest is never built.
2. **Layer 2 — `WHY.md` per tool.** ~10 min/tool. Delete any tool whose WHY can't be articulated.
3. **Layer 3 — Baseline `meta` blocks** (tool version, config hash, node version, commit SHA) so age-gate fires on config-hash mismatch too, not just calendar days.
4. **Layer 4 — Dumb `pnpm ops:health` aggregator.** Output only, no enforcement yet.
5. **Layer 5 — Weekly GitHub Actions cron + out-of-band Discord webhook** (not via the bot — the bot IS the system being audited). One summary, no escalation ladder.
6. **Month-3 evaluation.** Are the summaries being read? If yes, add 45-day CI age-gate. If no, the system is dead and more enforcement won't save it. **Do NOT pre-build the escalation ladder.**

**Why deferred**: bigger than a quick-win, smaller than a full epic. Sits in the "structural quality" bucket per the recovery-period quality-over-velocity goal.
