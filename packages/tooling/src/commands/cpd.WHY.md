# Why `cpd:filtered` / `cpd:check` / `cpd:update-baseline` exist

## What they do

Three commands wrapping the [jscpd](https://github.com/kucherenko/jscpd) copy-paste detector output:

- **`cpd:filtered`** — runs the post-filter against the current `reports/jscpd/jscpd-report.json` and prints the filtered count + breakdown. Excludes fragments where ≥80% of classifiable lines are call-expression shape (the "standardized helper call-site uniformity" false-positive class). This is the metric that reflects real duplication debt.
- **`cpd:check`** — compares the filtered count against the recorded baseline (`.github/baselines/cpd-baseline.json`) and exits non-zero on regression. CI gate.
- **`cpd:update-baseline`** — writes the current filtered count back to the baseline file. Used after intentional duplication changes; preserves the existing `graceMargin` / `threshold` / `notes` / `version` fields.

All three assume `pnpm cpd` has produced the jscpd JSON report first.

## Why they were built

Raw jscpd reports against TypeScript codebases are noise-dominated. When you extract a shared helper used by N consumers, every call-site looks structurally identical (`const result = await helperName(arg1, arg2);` × N), and jscpd's token matcher counts each pair as a clone. The number goes UP after a refactor that genuinely reduced duplication. This is the [Wrong Abstraction trap](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) inverted: jscpd punishes the right abstraction.

The CPD-reduction campaign that ran early 2026 reframed the goal mid-campaign — after 5 PRs (#1038-1042) — from "raw jscpd count → 0" to "filtered count under a recorded ceiling, with a documented boundary for what counts as real debt." The post-filter is the boundary: any fragment where call-expression sites dominate is excluded as structural uniformity, not duplication.

The full campaign audit is at `docs/reference/CPD_CAMPAIGN_AUDIT.md`. The 2-callback ceiling rule (don't extract a shared helper if it'd require more than 2 callback/predicate parameters) is the working heuristic that prevents this from being a treadmill.

## Drift detection (Layer 3)

`cpd:check` hard-fails when the baseline's stored `meta.configHash` doesn't match the current config fingerprint. The fingerprint hashes `{ threshold, filterImplVersion }` — the two inputs that affect measurement. Bumping `FILTER_IMPL_VERSION` in `postFilter.ts` (when the call-dominance heuristic changes) or changing the `--threshold` invalidates existing baselines and forces an explicit `cpd:update-baseline` refresh. Without this, a heuristic tweak silently makes every subsequent baseline comparison meaningless — the baseline floor was measured under different rules than the current run.

`graceMargin` is intentionally NOT in the fingerprint. It's a tolerance setting, not a measurement input — bumping it doesn't invalidate the underlying line count.

## Threshold rationale

The ratchet is `baseline.filteredLines + baseline.graceMargin`. `graceMargin` is intentional headroom for legitimate small regressions (a new feature genuinely adds some duplication that hasn't been worth extracting yet) — typically set to 20-50 lines.

The 0.8 (80%) call-expression dominance threshold in the post-filter is tunable via the `--threshold` flag on `cpd:filtered`. The current value was picked after the campaign audit found that ≥80% call-shape lines were the false-positive class; anything under that genuinely had non-call duplication worth tracking.

## Decay check

When this tool's reminder fires:

- Did jscpd get replaced with a better duplication detector that doesn't need the post-filter? Migrate or delete the tool.
- Is the filter excluding too much (real debt slipping through)? Raise the threshold or refine the call-expression heuristic.
- Is the baseline drifting up steadily despite refactors? The 2-callback rule may be too lax — re-read the campaign audit.
- Has the codebase grown to a size where the filter is too slow? jscpd itself becomes the bottleneck before the filter does, so this is unlikely.

The audit is at `docs/reference/CPD_CAMPAIGN_AUDIT.md`. Don't delete this tool without reading that first — the campaign closeout encodes hard-won lessons about why raw jscpd is the wrong metric.
