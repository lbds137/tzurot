# Why `memory:analyze` exists

## What it does

Scans `memories` table for duplicate rows produced by the "swiss cheese retry loop" pattern: same `persona_id` + `personality_id`, same user-message prefix, created within a 60-second retry window. Reports duplicate groups; `memory:cleanup` is the destructive sibling that deletes them (keeping the LAST row in each group, since that's the response users actually saw).

`--env local|dev|prod` for environment scoping. `--verbose` for per-group breakdown.

## Why it was built

The early ai-worker retry logic had a bug: when AI generation failed and got retried, each attempt stored a separate memory row even if only one response was ever delivered to the user. The user saw one message; the database had 3-5 versions of it stored as separate memories, each with slightly different content (the retry attempts had different generation outputs). The duplicate memories then re-surfaced in long-term memory retrieval, polluting future conversation context with phantom messages the user never saw.

The bug itself was fixed at the ai-worker layer (deduplication moved to before-store), but production databases accumulated months of dupes during the buggy window. `memory:analyze` is the audit that surfaces them; `memory:cleanup` is the surgical fix that removes them while preserving the one row that matches what the user actually saw.

The 60-second retry window is tight enough that legitimate same-prompt-different-time messages (e.g., user repeats a question 5 minutes later) aren't matched as duplicates.

## Threshold rationale

Zero post-cleanup duplicates is the goal. The audit doesn't fail CI — it's an operator tool, not a guard. Use it periodically to check whether new duplicates are appearing (would indicate the dedup logic regressed) or to verify a cleanup pass worked.

The "keep the LAST row" rule is load-bearing: the most recent memory in a duplicate group contains the response that passed dedup checks at delivery time. Older rows are retry-aborts that the user never saw.

## Decay check

When this tool's reminder fires:

- Has the retry-loop bug been fully eradicated (months without new duplicates)? Keep the tool for ongoing audit cadence; don't delete it.
- Is the dedup logic at ai-worker different enough that the 60-second window heuristic no longer matches the bug shape? Update the heuristic.
- Did the project move to a different memory backend? Either delete the tool or rewrite it against the new backend.

This is more of a one-shot remediation tool than a continuous audit — its primary value was the historical cleanup. Keeping it around as a "did anything regress?" check is cheap insurance.
