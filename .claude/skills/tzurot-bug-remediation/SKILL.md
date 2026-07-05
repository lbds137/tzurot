---
name: tzurot-bug-remediation
description: 'The recurring-bug remediation protocol: runtime evidence → root cause → exhaustive class sweep → seam-tier regression test → structural guard. Invoke with /tzurot-bug-remediation when a bug recurs, a "fixed" class regresses, or the owner says a failure "keeps biting".'
lastUpdated: '2026-07-05'
---

# Bug Remediation Protocol

**Invoke with /tzurot-bug-remediation** when fixing a bug that has recurred, when a
previously-"fixed" class regresses, or when the owner signals class-level pain
("keeps biting me", "this happens a lot", "why didn't tests catch it"). The
protocol exists because under-remediation recurs in a fixed shape: a symptom
patch on the one visible instance, a mocked unit test, and the class returns.

The five steps run IN ORDER. Skipping one is how the bug comes back.

## 1. Runtime evidence FIRST

- Reproduce, or capture the failing runtime observation (log line, prod trace,
  failing test). **Never fix on a code-read mechanism** — "code-reading suggests
  X" is a hypothesis until a tool confirms it (`00-critical.md` § code-reading
  is not runtime verification).
- If the observation isn't capturable today, **ship the one diagnostic that
  produces it** as its own commit (the `debug` type exists for this) and stop —
  the fix waits for the observation.
- Self-serve the evidence: Railway CLI (incl. ended-deploy logs), dev probes,
  `/inspect` output the owner already posted. Exhaust the query space before
  claiming data doesn't exist (see `/tzurot-deployment` § log forensics).

## 2. Root cause, not band-aid

- Reject as final answers: symptom patches, instrumentation-only "fixes",
  "graceful degradation" that hides the failure, retry-until-it-works.
  These may ship as stopgaps but the item stays open until the mechanism is
  named and closed.
- The tell you're band-aiding: the fix's explanation describes the _symptom_
  path, not why the state arose.

## 3. Exhaustive class sweep (the step that keeps failing)

- Define the CLASS the bug belongs to ("every route that builds this by hand",
  "every copy of this predicate", "every consumer of this field") and enumerate
  members **deterministically**: `pnpm ops xray --format md | grep`, depcruise,
  AST greps, schema introspection — NOT a sampled manual grep. Sampled greps
  miss the last route, the drifted copy, the extra consumer.
- Fix EVERY instance in the same change, or file each unfixed member as its own
  tracked item before closing. List the enumeration method + full member list
  in the PR body so review can check the sweep, not just the diff.
- If the class exists because logic is duplicated, consolidation is part of the
  remediation — see `/tzurot-reuse-scout`.

## 4. Regression test at the correct tier

- The test must fail on the pre-fix code. State which tier and why: a seam bug
  needs a seam/contract test (assert what crosses the mocked boundary), not a
  unit test that mocks the seam it's meant to verify (`02-code-standards.md`
  § Assert what crosses a mocked seam).
- If the bug survived because coverage was green-but-blind, say so and fix the
  blind spot — don't just add one more green test beside it.

## 5. Structural guard

- Ask the three questions from `00-critical.md` § Fix Recurring Failures
  Structurally: rule? skill step? hook/CI guard? For code classes, prefer a
  contract-level invariant the build enforces (a manifest test, a budget
  constant, a `guard:*` check, a schema-parity test) over documentation.
- A remediation with no recurrence-blocker is incomplete — if genuinely nothing
  structural fits, record why in the PR body.

## Closing checklist

- [ ] Runtime observation captured (or diagnostic shipped + item parked)
- [ ] Mechanism named; fix explains the cause, not the symptom
- [ ] Class enumerated deterministically; every member fixed or tracked
- [ ] Regression test fails pre-fix, at the right tier
- [ ] Structural guard shipped, or its absence justified in the PR
