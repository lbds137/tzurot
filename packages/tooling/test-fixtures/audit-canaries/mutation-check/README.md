# mutation:check canary fixture — DO NOT FIX / DO NOT REMOVE

`reports/mutation/config-resolver/mutation.json` is a deliberately
below-floor Stryker report: 5 killed / 5 survived = 50% mutation score
(plus one Ignored and one CompileError mutant to exercise the
excluded-from-denominator buckets). The canary test in
`src/audits/canary.test.ts` pairs it with a runtime-built baseline
(score 95, grace 1) and asserts `mutation:check` reports
`status: 'fail'` with findings > 0.

If the canary goes red, the CHECKER is broken (report parsing, score
arithmetic, or floor comparison) — do not "fix" this fixture to make
it pass.
