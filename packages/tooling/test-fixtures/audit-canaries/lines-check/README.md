# lines:check canary fixture — DO NOT FIX / DO NOT REMOVE

This directory is a fake repo root whose always-loaded surfaces are
deliberately over budget: `.claude/rules/oversized-canary.md` (40 lines
against a runtime baseline of 10 + grace 5) and `CURRENT.md` (20 lines
against a baseline of 5 + grace 2). The canary test in
`src/audits/canary.test.ts` pairs the fixture with a runtime-built baseline
(so its configHash tracks the CURRENT fingerprint) and asserts `lines:check`
reports `status: 'fail'` with findings > 0.

If the canary goes red, the CHECKER is broken (glob matching, line counting,
or the budget comparison) — do not "fix" this fixture to make it pass.
