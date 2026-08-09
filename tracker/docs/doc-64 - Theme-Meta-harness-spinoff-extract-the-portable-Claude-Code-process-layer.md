---
id: doc-64
title: 'Theme: Meta-harness spinoff - extract the portable Claude Code process layer'
type: other
created_date: '2026-08-09 16:25'
---

_Focus: the Claude Code process layer built here (rules, hooks, skills, agents, audit/ratchet tooling) has outgrown Tzurot — extract the portable majority into its own home, installable at the user level for other projects._

Owner directive (2026-08-09, verbatim): "the scope of the tooling we've been building has grown a lot, to the point of it almost being its own meta harness layer that deserves its own home... I'm thinking the new tooling repo would maybe end up having its instructions / tools installed at the user level somehow, so that it can be easily leveraged for other projects too."

**Versioning-honesty motivation** (owner, same day): recent betas have been essentially tooling-only — no user-facing changes — so Tzurot's version stream currently counts process-layer work as product releases. A separately-versioned plugin restores the meaning of a Tzurot release: plugin versions track the process layer, Tzurot versions track the product.

### The seam

Portable (the majority): the epistemics rules (speculation-vs-fact, negative-existence, code-reading-vs-runtime), interaction/working-posture layer, review-response state machine, session-mining, doc-audit economy pass, orchestration mode, and most hooks (lossy-pipe-guard, claim-shape-guard, pr-merge-review-check, bare-token, queued-receipt). These encode "how to run AI-driven development honestly," not "how Tzurot works."

Tzurot-bound: service boundaries, Discord/database/deployment rules, all parameter values (branch names, command names, baselines).

The hard middle: `packages/tooling`'s audit/ratchet infrastructure (lines:check, cpd post-filter, baseline-drift contracts, hook-probe registry, gh:ci-gate) — TypeScript wired into this repo's CI with this repo's baselines. Portable in concept, needs a real interface boundary (npm package + per-repo config) to travel.

### Proposed shape (assistant recommendation, pre-council)

**A Claude Code plugin, not a bare repo** — plugins are the harness-native distribution unit for exactly this payload (skills, hooks, agents, commands), installable at user level so every project inherits them. Two layers, in order:

1. **Process plugin**: skills + hooks + agent contracts. Mostly parameter-free already; cheapest extraction.
2. **Audit/ratchet npm package** (later): the `pnpm ops` gate infrastructure behind a config boundary.

**Brain-management mechanisms ride the plugin** (owner directive 2026-08-09: "the brain itself stays private but the mechanisms for setting it up and managing it would belong in the plug-in"). The plugin ships the doc-65 scaffolding — a brain-setup skill (create private repo, move the memory dir, symlink from the harness path), the session-end auto-commit hook, and any status/management commands — while the brain repo holds only data. Clean content/mechanism split, and it makes versioned memory a capability every plugin adopter gets rather than a Tzurot-local hack.

### Phase sketch

- **Phase 0 — inventory (decides everything)**: classify every rule section, hook, skill, and ops command as portable / Tzurot-bound / parameterizable-with-effort. Output: the classification table; it picks the split shape empirically.
- **Phase 1 — process plugin**: extract the parameter-free skills/hooks/agents; Tzurot consumes the plugin; deleted local copies prove the seam.
- **Phase 2 — ratchet package**: extract the audit-tool layers behind config; Tzurot pins a version.
- **Phase 3 — hardening**: versioning/drift story between the two repos (the guard:workflow-sync class of problem multiplies across repos — design for it, not into it).

### Sequencing conditions

- **After the economy pass** (PR #2028 et seq.) — extract the trimmed essence, not the bloat.
- Substantial pick → council pass before plan-mode (per queue convention).
- Interacts with: doc-62 (memory promoter — promoted content should land in the portable layer when general), doc-63 (ratchet bidirectionality — its cadence design should assume the ratchets may move to the shared package).
