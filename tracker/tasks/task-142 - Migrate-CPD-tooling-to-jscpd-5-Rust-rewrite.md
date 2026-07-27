---
id: TASK-142
title: 'Migrate CPD tooling to jscpd 5 (Rust rewrite)'
status: To Do
assignee: []
created_date: '2026-06-08 00:00'
labels:
  - 'area:tooling'
  - 'area:db'
  - 'area:ci'
dependencies: []
ordinal: 142000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Migrate CPD tooling to jscpd 5 (Rust rewrite)

**Why:** jscpd 5.0.4 is a fresh Rust rewrite (shipped 2026-06-08; v4.2.5 shipped 2026-06-07, so v4 is still maintained in parallel). The dev-deps dependabot bump to 5.x was reverted to 4.2.5 and pinned via `.github/dependabot.yml` major-version ignore (see PR #1180). **Three concrete things break/shift under 5.x, all investigated 2026-06-08:** (1) **Config `ignore` key is silently dropped** — the Rust binary only honors ignore via the CLI `--ignore-pattern`/`-i` flag, NOT the `.jscpd.json` `ignore` array. Verified: with `-i "<patterns>"`, clones drop 2288→166 (0 in ignored files); without, 93% of clones (2123/2288) are in test/generated files we exclude, ballooning the filtered count 1718→30255 and tripping the ratchet. All OTHER config keys (`minTokens`, `minLines`, `format`, `threshold`) ARE honored (tested: minTokens 50→166 clones, 200→2). (2) **Genuine detection drift** — at identical minTokens=50/minLines=10, the Rust engine reports MORE duplication than the JS engine: filtered 2786 (Rust) vs 1718 baseline (JS), once ignores are restored. Needs a re-baseline. (3) **Post-filter heuristic suspect** — `packages/tooling/src/cpd/postFilter.ts` excluded only 4 clones as call-dominant on the Rust output (vs hundreds on JS output); the Rust fragment shape may not match the call-dominance parser, possibly inflating (2). **Migration steps**: (a) move ignore patterns from `.jscpd.json` `ignore` → the `cpd`/`cpd:report` scripts' `-i` flag (comma-separated) — or file an upstream bug for config `ignore` and wait; (b) re-validate/adjust the call-dominance heuristic in `postFilter.ts` against jscpd-5 fragments; (c) spot-check the residual is skeleton-noise not real debt, then `pnpm ops cpd:update-baseline` to the jscpd-5 number. **No upstream issue exists yet for the config-`ignore` regression** (v5 is days old) — we'd own the workaround. **Promote when**: a jscpd 5.x feature becomes compelling (current draw is only speed, which we don't need — our CPD run is sub-second), or v4 maintenance stops. Surfaced by dependabot PR #1180 (jscpd 4.2.4→5.0.4). Deferred 2026-06-08.
<!-- SECTION:DESCRIPTION:END -->
