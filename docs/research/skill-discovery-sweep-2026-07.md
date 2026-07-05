# Skill-Discovery Sweep — July 2026 (TL;DR)

Distilled record of the mined-corpus re-sweep that produced the `/tzurot-design-boulder`,
`/tzurot-bug-remediation`, and `/tzurot-reuse-scout` skills. Kept so "why isn't X a
skill?" has a durable answer. Method: full re-read of the six mined session reports +
synthesis (six weeks of transcripts) with a new-skill-discovery lens; a candidate
qualified when it (1) recurs across sessions, (2) has non-obvious steps re-derived each
time, (3) isn't already covered by a skill/rule.

## Skill-ified (highest recurrence × pain)

1. **Recurring-bug remediation** → `/tzurot-bug-remediation`. 5/6 sessions carried the
   class ("keeps biting", "why didn't tests catch it"). The step that consistently
   failed: exhaustive _deterministic_ class enumeration (sampled greps missed members).
2. **Reuse-scout / drifted-duplicate consolidation** → `/tzurot-reuse-scout`. 6/6
   sessions; semantic drift is invisible to CPD; the pre-write scout had tooling but no
   decision-point trigger.
3. **Design-boulder cadence** → `/tzurot-design-boulder` (was already planned; the
   sweep confirmed nothing else in the design space needed separate codification).

## Folded into existing homes (real but overlap-heavy)

- **Post-compaction active recovery** → CLAUDE.md compaction block (ordered
  recover-list: settings → promises → work-stack → smoke state). A standalone skill
  can't help here — the moment of need is exactly when the invocation reflex is gone;
  the always-loaded block is the right surface.
- **Backlog quick-wins / net-shrink sweep** → `tzurot-docs` skill (find → batch →
  consolidate → measure shrink; net-shrink is the success metric).
- **Log-exhaustion forensics** → `tzurot-deployment` (self-serve-first line; the
  ended-deploy/level-grep/query-DSL mechanics were already there).
- **Pre-release risk & coverage appraisal** → `tzurot-git-workflow` release step 0
  (risk level + diff-derived smoke scope + coverage-gap offer, produced unprompted).

## Checked and rejected as already-covered

Human-verification/smoke choreography (`tzurot-testing`); release execution runbook
incl. prerelease/latest flip, ff-merge fallback, premigrate (`tzurot-git-workflow`);
council consultation (`tzurot-council-mcp`); fix-now/"pre-existing is not an excuse"
(rule, not procedure); promise ledger (`06-backlog`); claude-review health
(`05-tooling`); DB migration, session start/end, architecture health, doc freshness
(existing skills). UX-consistency auditing is boulder-shaped (a theme, not a
procedure).

## Watch-list (single-session, not yet recurring)

- Discord webhook manual-setup runbook (thread_id param, integrations click-path,
  secret verify) — one session only; revisit if it recurs.
