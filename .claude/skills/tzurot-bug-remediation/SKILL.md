---
name: tzurot-bug-remediation
description: 'The recurring-bug remediation protocol: runtime evidence → root cause → exhaustive class sweep → seam-tier regression test → structural guard. Invoke with /tzurot-bug-remediation when a bug recurs, a "fixed" class regresses, the owner says a failure "keeps biting", OR at the FIRST fix of a path-specific UI/flow bug (create/edit/browse/view/delete) — to sweep sibling flows before declaring it fixed.'
lastUpdated: '2026-10-11'
---

# Bug Remediation Protocol

The protocol is the Seyag `bug-remediation` skill (`/bug-remediation`, `seyag:bug-remediation`); load it and follow it, including its first-fix sibling sweep and its closing checklist (`seyag:bug-remediation § Closing checklist`). This file holds only the Tzurot bindings. The "code-read-only" label on a first-fix claim stays until the owner's runtime smoke confirms it.

If the seyag plugin is not loaded in this session (a cloud unit or the CI review action may lack it), the pointers below do not resolve: say so, and hand the procedure step to the driver or the owner instead of reconstructing it.

## 1. Runtime evidence FIRST

Procedure: `seyag:bug-remediation § 1. Runtime evidence first`. Tzurot bindings:

- The diagnostic commit uses the `debug` type (`05-tooling.md` § The `debug` type).
- Self-serve the evidence: Railway CLI (incl. ended-deploy logs), dev probes, `/inspect` output the owner already posted. Exhaust the query space before claiming data doesn't exist (see `/tzurot-deployment` § log forensics).

## 2. Root cause, not band-aid

Procedure: `seyag:bug-remediation § 2. Root cause, not band-aid`.

## 3. Exhaustive class sweep (the step that keeps failing)

Procedure (including sweeping the class's tests): `seyag:bug-remediation § 3. Exhaustive class sweep`. Tzurot bindings:

- Enumerate members deterministically with `pnpm ops xray --format md | grep`, depcruise, AST greps, schema introspection.
- Consolidation of duplicated logic: `/tzurot-reuse-scout`.
- To name the test that covers each member, grep the symbol, the fixture constant, and the file's colocated `.test.*`/`.probe.*`.

## 4. Regression test at the correct tier

Procedure: `seyag:bug-remediation § 4. Regression test at the right tier`. Tzurot binding: a seam bug needs a seam/contract test that asserts what crosses the mocked boundary (`02-code-standards.md` § Assert what crosses a mocked seam).

## 5. Structural guard

Procedure: `seyag:bug-remediation § 5. Structural guard`. Tzurot bindings: the three questions are in `00-critical.md` § Fix Recurring Failures Structurally; the build-enforced invariant is e.g. a manifest test, a budget constant, a `guard:*` check, or a schema-parity test. Seyag's hook-replay bullet maps here to the hook's `.claude/hooks/<name>.probe.sh` and `pnpm ops guard:hook-probes` (`05-tooling.md` § Guards).
