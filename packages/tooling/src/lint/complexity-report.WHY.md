# Why `lint:complexity-report` exists

## What it does

Walks the project ESLint config's `max-lines`, `max-lines-per-function`, `complexity`, `max-statements`, and `max-depth` rules and reports findings at 80% of the hard limit (`WARNING_THRESHOLDS`) and at 100% (`ACTUAL_LIMITS`). Output modes: human-readable (default), `--verbose`, `--json` (CI dashboards), `--summary` (audit aggregator JSONL).

## Why it was built

The project's ESLint config already enforces these limits at the hard ceiling — `complexity > 20` fails CI. The report runs against the 80%-warning threshold so functions approaching the limit are visible BEFORE they trip it. The actual fix is always "extract a helper" or "data-driven refactor" — the report just surfaces which files are getting close so the work happens during normal touch-and-edit, not as a fire drill when a CI break forces it.

The pattern was originally surfaced during the bot-client refactor campaign (~PR #800-series): functions had crept past the limits without anyone noticing until CI rejected the next commit that nudged them over. The report converts "surprise CI fail" into "you can see this coming."

## Threshold rationale

`WARNING_THRESHOLDS` is `floor(ACTUAL_LIMITS × 0.8)`. The 80% factor is a deliberate underapproximation — not "approaching limit" in the literal-percent sense, but "close enough that the next medium-sized addition will trip it." If `complexity: 20` is the hard limit, anything at 16+ is one new `else if` away from failure.

The 80% factor isn't sacred — bump it if too many low-signal warnings appear, lower it if violations sneak through. Edit `THRESHOLD_PERCENT` at the top of `complexity-report.ts` and the warnings re-shape accordingly.

## Decay check

When this tool's reminder fires (Layer 5 cron, planned) and you can't immediately answer "yes, I want to keep seeing complexity warnings before they fail CI":

- Has the project shrunk to a size where complexity isn't a worry? Delete the tool.
- Are you ignoring its output anyway? Delete the tool.
- Did the team move to a different code-quality metric? Replace the tool.
- Still useful but noisy? Adjust `THRESHOLD_PERCENT` or the per-rule limits in `eslint.config.js`.

Don't keep the tool out of inertia. The point of this check is to be useful or to be gone.
