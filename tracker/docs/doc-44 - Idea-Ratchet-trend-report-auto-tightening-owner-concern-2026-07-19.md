---
id: doc-44
title: 'Idea: Ratchet trend report + auto-tightening (owner concern 2026-07-19)'
type: other
created_date: '2026-07-28 11:11'
---

## Ratchet trend report + auto-tightening (owner concern 2026-07-19)

**Problem**: the repo runs ~6 ratchets/baselines (ux:literals, cpd:check, test:audit coverage, mutation floors, lines:check, codecov) but they are anti-regression gates, not progress drivers — a baseline only moves when someone runs the tool's `--update`, and nothing surfaces a baseline that has sat slack (current comfortably under ceiling) for months. Owner: "they have a tendency to end up forgotten and accepted at whatever baseline we left them at." The weekly audit's health report already renders a **ratchet-margins section** (lines/cpd/mutation headroom via `health-extras.ts`) posted to Discord, but (a) it deliberately has NO trend ("no comparison vs prior report artifact" — health.ts's own doc), (b) ux:literals and coverage aren't in the margins section, and (c) nothing ever tightens a baseline automatically.

**Fix shape** (three independent increments):
1. ~~**Complete the margins section**: add ux:literals + test:audit to the weekly ratchet-margins block (both have cheap live measures).~~ **SHIPPED** — both rows render live (ux-literals with lower-is-better + tightening-candidate framing; coverage with knownGaps-as-parked-debt, NEW, and fixed-but-stale annotations).
2. **Trend deltas**: persist each week's margins as a workflow artifact (or committed JSONL history under .github/baselines/); render `current (Δ vs last week)` per ratchet so stagnation is visible, not silent.
3. **Auto-tighten proposal PRs**: when a live measure beats its baseline by more than noise, the weekly audit opens a baseline-tightening PR (never auto-merge — baselines are review-gated config). Turns "ratchet" from metaphor into mechanism.

**Promote when**: ~~owner schedules it~~ **PROMOTED to the working queue (owner 2026-07-20)** — reinforced by session-mining finding 4b (ratchet stagnation recurred as an explicit concern; "they end up forgotten and accepted at whatever baseline we left them at"). Land the three increments in order; increment 1 (complete the margins section) is the cheap first slice. Pick it up as a Quick Win when a session has slack, or ride the next weekly-audit touch.

