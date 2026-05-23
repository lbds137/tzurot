# Canary rule file: deliberate dangling command reference

DO NOT MODIFY. This is a CANARY FIXTURE for `guard:claude-content-refs`.
The reference below points at a deliberately-nonexistent `pnpm ops`
command — the canary test asserts the audit tool flags it.

If a future contributor "fixes" this by deleting the reference or adding
the command to the CLI, the canary test will start producing 0 findings
and the tool's silent-misconfiguration failure mode goes undetected.

## Canary content

Run `pnpm ops nonexistent:canary-target` to do the thing.
