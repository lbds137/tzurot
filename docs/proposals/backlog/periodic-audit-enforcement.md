# Periodic Audit Enforcement Architecture

> **Status**: Proposal, drafted 2026-05-22 via 4-model council pass (Gemini 3.1 Pro → GLM 5.1 → Kimi K2.6 → Opus 4.7)
> **Scope**: How to ensure the ~7 ops commands + 2 slash skills documented as "run periodically" or "one-shot quarterly" actually get run — without a system that itself rots or becomes notification spam.
> **Lifecycle**: This doc will be promoted to `docs/reference/` (or deleted) once the canary + fixture pattern ships and the first cron iteration runs for ≥3 months.

## The problem

Tzurot has strong CI-gated enforcement (17+ checks per PR) for things that change on every commit. The gap is the long-cadence tooling: audits designed to be run "after major refactors" or "quarterly" with zero mechanism to actually trigger them.

**Inventory of dust-collecting tools** (no enforcement, no schedule, no last-run tracking):

| Tool                                              | Documented cadence                                  |
| ------------------------------------------------- | --------------------------------------------------- |
| `/tzurot-arch-audit` (slash skill)                | "Before PRs, start of session, after major changes" |
| `/tzurot-doc-audit` (slash skill)                 | "After adding new tools, after major refactors"     |
| `pnpm ops xray --summary`                         | Periodic package-health snapshot                    |
| `pnpm ops dev:schema-audit`                       | "One-shot quarterly"                                |
| `pnpm ops voice-refs:audit --env prod`            | Voice clip length audit                             |
| `pnpm ops lint:complexity-report`                 | Files/functions near ESLint complexity limits       |
| `pnpm ops memory:analyze`                         | Duplicate-memory analysis                           |
| `pnpm ops db:check-drift`                         | Migration drift                                     |
| `pnpm ops db:check-safety`                        | Dangerous migration patterns                        |
| `pnpm ops inspect:queue` / `pnpm ops inspect:dlq` | BullMQ + dead-letter inspection                     |

**Smoke-signal evidence the gap is real**:

- `.github/baselines/test-coverage-baseline.json` was last updated 2026-02-08 (3+ months stale on the day this doc was drafted)
- `cpd-baseline.json` was current (4 days stale) — both baselines exist, only one is being maintained
- Zero scheduled GitHub Actions workflows; zero cron of any kind

## Constraints

1. **Solo dev** on Steam Deck (Fedora distrobox). Attention is the scarcest resource — the system must not depend on the developer remembering.
2. **GitHub Actions cron available**, but solo-dev means no team to triage CI noise. False positives are a death spiral.
3. **Existing Discord bot in prod** — available as a notification channel, with one critical caveat (see "out-of-band webhook" below).
4. **Existing Claude Code hooks** (PreToolUse / PostToolUse / UserPromptSubmit) — primitive available, but loadout cost matters.
5. **No backwards compatibility required** — solo dev project, tool output shapes can change freely.

## Architecture (synthesized from 4-model council pass)

The core architecture is **GLM 5.1's skeleton** (CI age-gate + dumb aggregator) + **Kimi K2.6's polish** (markdown baselines, escalation deferred, GitHub Actions API as timestamp ledger) + **Opus 4.7's foundational additions** (canaries, golden fixtures, baseline meta blocks, `WHY.md`, out-of-band webhook). **Gemini 3.1 Pro's contribution that survived**: standardized JSONL summary line per tool (one line for aggregator parsing; full report stays human-readable text).

### Layer 1 — Validate the tools work (foundational, must be built first)

Every existing audit tool gets:

- **Golden fixture** — a `fixtures/<tool-name>/` snapshot of known-good input. CI runs the tool against the fixture on every PR and asserts the output matches an expected JSONL summary line. Catches "tool was working in March, then a dep bump broke it silently."
- **Canary file** — a deliberate violation that the tool MUST find. Example: `fixtures/lint-complexity-report-canary/known-complex.ts` is intentionally over the complexity threshold. If `lint:complexity-report` ever reports 0 findings against the canary, the tool is reading the wrong path or has a silent filter. Catches the failure mode where "correct binary, wrong input" produces clean-looking output.
- **JSONL summary line** — every tool emits exactly one line of JSON to stdout in a standard shape: `{"tool": "name", "status": "ok|warn|fail", "findings": N, "baseline": M, "meta": {...}}`. Full human-readable report goes to stderr (or to a markdown file). The aggregator parses only the JSONL line.

**Critical insight from Opus**: every other layer depends on the audits actually working. Without canaries, the rest of the system can report perfect health while everything decays — Potemkin enforcement. Build this first or build on sand.

#### Layer 1 sibling — Proposal orphan-check (added during proposal-triage pass)

This proposal-doc rot pattern is the same shape as the tool rot pattern. A proposal exists, no backlog file links to it, no one ever reads it again. Discovery pass on 2026-05-22 found **7 of 14 existing proposals had zero inbound links** — one of them (`tts-phase-3-voice-consolidation-plan.md`) was already-shipped and should have been deleted months ago per the lifecycle rule in `07-documentation.md`.

The proposal orphan-check is a regular-CI (NOT cron) gate with the same shape as the canary/golden-fixture pattern:

- For every `docs/proposals/backlog/*.md`, assert at least one inbound link from `backlog/**/*.md`, `CURRENT.md`, or any non-proposal markdown under `docs/**/*.md` (so links from `docs/research/`, `docs/incidents/`, `docs/README.md`, etc. all count). Links between proposals don't count — proposals linking to other proposals doesn't satisfy "tracked from somewhere actionable."
- Newly-added proposals MUST add the link in the same PR (forces the "this is real future work" vs. "this is just a brainstorm" decision at proposal time, not 6 months later).
- Existing orphans are grandfathered via an explicit allowlist; the allowlist itself must be aged out within N days or each entry needs a triage decision (link / icebox / delete).

Implementation note: ~20 lines of CI script. Runs in the existing `lint` job, no new infrastructure. The grandfathered-allowlist pattern matches how the CPD baseline absorbs pre-existing duplication.

**Layer 1 PR status (filed PR #1082)**: The orphan-check ships as a hard gate (any orphan fails CI) without the grandfathered-allowlist mechanism. Justified because the discovery pass that motivated this work triaged the 7 historic orphans inline — current state has zero orphans, so the gate is satisfied as-is. The allowlist becomes necessary only if a future PR introduces a proposal whose linking is deliberately deferred (e.g., a brainstorm a contributor wants to keep but not promote); at that point, add the allowlist plus aging-out logic. Filing the gate now without the allowlist trades implementation completeness for shipping a working check earlier — same pattern as Layer 1 itself (validate first, build enforcement on top).

**Why this belongs in Layer 1**: it's the same "validate the system works" check as canaries, just applied to proposals instead of audit tools. Both catch the same failure mode (something exists but isn't being used). Both run in regular CI, not cron.

### Layer 2 — `WHY.md` per tool (solo-dev psychology fix)

Every audit tool gets a one-paragraph `WHY.md` next to it explaining what problem it caught the day it was built. When a reminder fires at month 4 and you've forgotten why the tool exists, you read the `WHY.md`. Either re-up the commitment or delete the tool — both are correct outcomes.

**Solo-dev decay curve** (from Opus, the most useful psychological model in the council pass):

- Weeks 1–2: built it, remember it, no enforcement needed
- Weeks 3–8: honeymoon over, recent enough that reminders feel relevant
- **Weeks 9–16: danger zone**. Tooling feels like overhead from a past version of you. Escalation backfires — you mute the channel or add a bypass flag.
- Month 5+: either the system is dead (you bypassed it) or it's invisible infrastructure (it just works and you trust it)

`WHY.md` is the mechanism that lets month-4-you decide whether month-1-you's instincts still hold.

### Layer 3 — Baseline meta blocks (anti-drift)

Every baseline file (markdown, NOT JSON — see below) carries a metadata header:

```markdown
<!--
tool-version: 1.2.3
config-hash: a1b2c3d4
node-version: v25.3.0
generated-from-sha: abc123def
generated-at: 2026-05-22T16:32:00Z
-->
```

**Why this matters** (Opus's insight neither Gemini nor GLM raised): baselines go stale not just because the codebase changed, but because:

- Tool config drifted (complexity threshold bumped from 15 to 20; baseline still reflects old threshold)
- Dependency changed measurement semantics (TS 5.4 → 5.5 changes complexity scoring)
- Baseline was committed against WIP code

**Age-gate fires on config-hash mismatch, not just calendar days.** Without this, a 3-month-old baseline against a config bumped last week is reporting against a different reality than the code is running against.

### Layer 4 — Markdown baselines (not JSON)

`ops/baselines/<tool>.baseline.md` per tool. Markdown because `git diff` against markdown is human-readable; against JSON it's an unreadable line-noise wall.

**Refresh requires a one-line commit-message note explaining the change** ("complexity up because added retry logic to DLQ handler"). If you can't articulate why it changed in one line, you haven't earned the refresh. This is the mitigation against "`baseline:refresh` becomes muscle memory" at month 6 — a forcing function that requires 10 seconds of looking at the diff.

### Layer 5 — Dumb aggregator (`pnpm ops:health`)

```typescript
// Roughly:
const TOOLS = ['lint:complexity-report', 'dev:schema-audit', 'voice-refs:audit', ...];
for (const tool of TOOLS) {
  const { jsonl, exitCode } = await runOpsCommand(tool);
  // parse the one JSONL summary line, fail if missing or malformed
}
```

**No clever orchestration.** No file-hash invalidation. No conditional execution. A `for` loop over 7 tools. Solo dev on Steam Deck can debug this half-asleep. Gemini's smart-orchestrator was premature optimization for a context with 7 tools and ~5 seconds total runtime.

### Layer 6 — Weekly GitHub Actions cron + out-of-band webhook

`.github/workflows/weekly-audit.yml`, cron `0 9 * * 6` (Saturday 9 AM):

1. Runs on `ubuntu-latest` (NOT Steam Deck — heat, battery, fan noise are real)
2. Executes `pnpm ops:health`
3. Commits any baseline changes with an autogenerated commit message that includes the JSONL deltas
4. Posts a summary to Discord via an **out-of-band webhook** — NOT through the bot

**Why out-of-band**: the Discord bot IS the system being audited. When the bot is broken (which is exactly when you need an audit notification), the notification channel is broken too. Circular dependency. Use a separate webhook URL configured in the workflow that posts to the same channel via Discord's webhook API directly. Discord bot down? Webhook still works.

### Layer 7 — CI age-gate at 45 days (NOT 30)

A PR check that fails if no successful run of `pnpm ops:health` happened in the last **45 days**. Why 45 instead of 30: solo devs take vacations. 30 days false-positives on a 2-week holiday plus a flu. Kimi's number, and it's right.

Age comes from **GitHub Actions API run history** (`gh api repos/.../actions/workflows/weekly-audit.yml/runs`) — not from a file in git. No `lastRunAt` JSON to merge-conflict. The cron's own success log is the timestamp.

Plus: age-gate also fires on **config-hash mismatch** (per Layer 3). 30 days old AND config unchanged → fine. 5 days old AND config changed → re-run required.

### Layer 8 — Runtime pulses are a separate system, NOT this one

`inspect:queue` and `inspect:dlq` get EVICTED from the audit machinery entirely. They are runtime diagnostics — wall-clock-time-sensitive, no meaningful baseline (the "right" DLQ depth is always zero, not whatever was there last week).

These move to the Discord bot's own event loop:

```typescript
setInterval(
  async () => {
    const dlqDepth = await getDlqDepth();
    if (dlqDepth > 0) sendDM(`DLQ has ${dlqDepth} items`);
  },
  5 * 60 * 1000
);
```

**Why this matters**: putting runtime pulses in a monthly audit is saying "I will only learn my queue is backed up once a month." Absurd. Static audits and runtime pulses share the `ops:health` reporting layer (one dashboard) but nothing else.

## Build order

The strongest insight from the council pass was Opus's argument that **build order matters more than the architecture**. Everything depends on the audits actually working — without that foundation, more layers just create elaborate Potemkin reporting.

| Order | Item                                                                                                                                                  | Effort              | Survives if nothing else ships?        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| 1     | Canary + golden fixture for the 2 least-trusted tools, in regular CI                                                                                  | ~2 days             | **Yes** — this alone is high-leverage  |
| 2     | `WHY.md` per tool. Delete tools whose WHY you can't articulate.                                                                                       | ~10 min/tool        | Yes — surfaces dead tooling on its own |
| 3     | Baseline `meta` blocks (tool version, config hash, node version, SHA)                                                                                 | ~1 day              | Yes — improves baseline correctness    |
| 4     | Dumb `pnpm ops:health` aggregator. **Output only, no enforcement yet.**                                                                               | ~1 day              | Yes — manual runs become trivial       |
| 5     | Weekly GitHub Actions cron + out-of-band Discord webhook. One summary, no escalation.                                                                 | ~1 day              | Yes — passive monitoring               |
| 6     | **Evaluate at month 3.** Are you reading the summaries? If yes, add 45-day CI age-gate. If no, the system is dead and more enforcement won't save it. | Decision, not build | n/a                                    |

**The first item is non-negotiable.** Steps 2–5 are progressively less critical. Step 6 is the inflection point — if the weekly summaries are being read after 3 months, the foundation is working and additional enforcement is justified. If they're not, no amount of escalation will save the system.

## Rejected alternatives (and why)

These were considered and rejected in the council pass. Documenting them so future-us doesn't re-litigate.

### Centralized audit ledger (`.tzurot/audit-ledger.json`)

**Rejected because**: branches + concurrent runs = JSON merge conflicts on timestamp fields. Solo devs branch all the time (stashes, cherry-picks, parallel work on multiple PRs). Git history is the ledger — read the GitHub Actions API for run timestamps; read git log on baseline files for last-modified dates. Don't write the timestamps to a file.

### Auto-ratchet on improvements ("automatically lower baseline when findings drop")

**Rejected because**: if an audit silently breaks and reports 0 findings, auto-ratchet permanently lowers the baseline to 0, destroying the signal. Next time the tool is fixed, 50 real issues appear as "new" and the audit becomes noise. **Baselines move only via explicit human commit** with a one-line note explaining why.

### Claude UserPromptSubmit hook for overdue audit reminders

**Rejected because**: (a) token spend on hidden notes injected into every prompt; (b) Steam Deck latency from file-system reads + hash math on every prompt; (c) context pollution — a 2 AM production bug doesn't need 3-month-old schema-drift reasoning competing for context window space.

### Monthly maintenance PR (auto-opened with delta checklist)

**Rejected because**: solo-dev PR queues become graveyards. PR opens on the 1st, gets stale by the 15th, by the 20th you force-push just to land it without reading it. Becomes the exact issue-tracker rot the design was meant to avoid. The CI age-gate is the same forcing function with less ceremony.

### Discord bot as primary notification channel

**Rejected because**: the bot IS the system being audited. When the bot is down (precisely when alerts matter most), the alert channel is dead. Use Discord's webhook API directly from the GitHub Action — out-of-band — so notifications survive bot outages.

### Escalation ladder (Discord post → DM at 24h → CI block at 72h)

**Deferred, not rejected.** The ladder is calibrated for teams where social pressure matters. Solo dev has no audience to perform urgency for. The recommendation is: ship the weekly summary first, evaluate at month 3 whether it's actually being read, and only then add escalation if attention is genuinely the bottleneck. **Loud failure trains solo devs to mute.**

### Activity-based invalidation (file-hash triggers instead of pure-time cadence)

**Rejected as standalone, partially absorbed.** Gemini's idea was that `db:check-drift` should only run when `prisma/schema.prisma` changes. The problem: this collapses the "I haven't touched this in 3 months and want assurance nothing has bitrotted" use case. Solution adopted: time-based cadence as the default, file-hash as the early-trigger overlay (run early if the file changed, but also run on the calendar regardless).

### Smart orchestrator that runs only "due" audits

**Rejected because**: with 7 tools and ~5 seconds total runtime, conditional execution is premature optimization. The dumb aggregator that runs all 7 every Saturday morning is debuggable half-asleep. Add cleverness when the runtime exceeds 30 seconds, not before.

## Open questions for the month-3 evaluation

These are deferred decisions that should be re-examined once Layer 1–5 have been running for 3 months:

1. **Are the weekly Discord summaries being read?** If yes, escalation can be added. If no, the system is dead and the answer is to delete it, not add more pressure.
2. **Which tools surfaced real findings vs. always-green noise?** Tools that have never moved in 3 months may not deserve the slot in `ops:health`.
3. **What's the actual config-hash mismatch frequency?** If meta-block age-gates fire constantly, the threshold is wrong. If they never fire, the dimension is irrelevant.
4. **Did any canary tests catch a real tool breakage?** If yes, validates the Layer 1 investment. If no in 3 months, doesn't mean the layer is wrong (the failure mode is rare) but does inform whether to add canaries to additional tools.
5. **Did the auto-fix branch idea (Kimi's, deferred) actually come up?** If a tool develops mechanical-fix capability, the auto-fix branch becomes more interesting. Right now it's premature.

## References

- Inventory of currently-enforced checks: `.github/workflows/ci.yml`, `.husky/pre-commit`, `.husky/pre-push`, `.claude/hooks/`
- Stale-baseline evidence: `.github/baselines/test-coverage-baseline.json` (3+ months without an update at time of writing)
- The two skills marked-periodic: `.claude/skills/tzurot-arch-audit/SKILL.md`, `.claude/skills/tzurot-doc-audit/SKILL.md`
- The schema-audit tool's "one-shot quarterly" framing (the immediate trigger for this discovery): `docs/reference/tooling/schema-audit.md`
- Council pass model IDs (drift-prone, verified 2026-05-22): `google/gemini-3.1-pro-preview`, `z-ai/glm-5.1`, `moonshotai/kimi-k2.6`, `anthropic/claude-opus-4.7`
