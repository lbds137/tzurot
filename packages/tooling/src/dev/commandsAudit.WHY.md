# Why `commands:audit` exists

## What it does

Reads the auto-generated slash-command manifest (`services/bot-client/command-manifest.json`, produced by `commandManifest.test.ts`) and does two things:

1. **Inventory** — renders the whole command surface (`--format tree|md|json`): every command, its category, handler badges (autocomplete/select/button/modal), subcommand groups, subcommands, and leaf options with their Discord type, required flag, and autocomplete flag. The `md` form is the "whole surface at a glance" doc.
2. **Consistency checks** — five rules, each emitting a finding with a severity:
   - **category-coverage** (error): every command's `category` must be a named `/help` category (the `helpCategories` set minus `"Other"`). A category that isn't named silently buckets the command into `/help`'s "Other" group — invisible discoverability rot. This is the highest-value check.
   - **description-presence** (error/warn): every command, group, subcommand, and option must have a non-empty description (error); stub-like descriptions (< 12 chars or matching `test|todo|tbd|xxx`) warn.
   - **subcommand-naming** (warn): subcommand names outside the canonical vocabulary from `.claude/rules/04-discord.md` ({browse, view, create, edit, delete, list, default, free-default}) warn; `list` specifically warns that `browse` is preferred for new commands.
   - **option-name-drift** (warn): the same option name carrying different Discord types across commands, or near-synonym names (preset/config, persona/profile) used for the same concept.
   - **component-handler-completeness** (error): a command that participates in component routing (declares `componentPrefixes` or exports a button/select handler) must export the corresponding handlers — otherwise component interactions are silently dropped.

Exits non-zero when any error-severity finding exists, so it can gate CI. The `--summary` mode emits one JSONL audit-summary line for the future aggregator.

## Why it was built

The slash-command surface is the bot's primary UX and it sprawls across 13 command folders maintained independently. Three failure classes recur and none is caught by type-checking: (a) a new command folder whose name isn't wired into `CATEGORY_CONFIG` disappears into `/help`'s "Other" bucket; (b) descriptions drift to placeholders or empty strings that ship to users; (c) subcommand/option naming diverges across commands so the same concept gets different names. The manifest indirection is forced — command modules can't be imported outside the bot-client mocked test harness (some throw at module load on missing `REDIS_URL`, others open a Redis connection and hang), so the only clean inventory source is `CommandHandler.loadCommands()` inside vitest. This tool consumes the manifest that the bot-client drift-guarded test emits.

## Threshold rationale

The pass/fail gate is binary on **error-severity** findings, not a ratcheted count — consistent with the other `guard:*` gates, which are "is this in sync?" checks rather than measurements with a tunable threshold. There is intentionally no baseline file: a missing category or empty description is always wrong, so the right target is zero, not "no worse than last week." Warnings (stub descriptions, naming drift, option-name drift) are surfaced but don't fail CI — they're judgment calls for review-time triage. The stub-description length floor (12 chars) and the synonym clusters are deliberately conservative to keep false positives low; widen them only if real drift slips through. The option-name-drift heuristic only fires when both a type conflict or both synonym names are actually present in the surface, so it can't flag a single-use name.

## Decay check

When this tool's reminder fires and you can't immediately say "yes, I want the command surface gated for category coverage and description presence":

- Did the command surface shrink to a handful of commands where drift is self-evident? Consider deleting the tool.
- Is the `/help` category mechanism gone (e.g. replaced by a flat command list)? The category-coverage check becomes meaningless — drop it or retarget.
- Are the naming-drift warnings pure noise you always ignore? Tighten or remove `KNOWN_SUBCOMMAND_NAMES` / `SYNONYM_CLUSTERS` rather than letting the tool cry wolf.
- Is the manifest generator (`commandManifest.test.ts`) still running? If that test is deleted or skipped, this tool audits a stale snapshot — the two are a pair; neither should outlive the other.

The tool's job is to make command-surface drift impossible to ship silently. Keep it as long as commands are added by independent edits to separate folders.
