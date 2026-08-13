# Why `dev:stale-debug` exists

## What

Walks `git log --grep '^debug[:(]'` (the temporary-diagnostic commit type from
`.claude/rules/05-tooling.md`), filters OUT net-DELETING commits (a
`debug: remove` commit legitimately owns residue and must not flag; net-zero
commits stay in, because a probe inserted by replacing a line is exactly the
scaffolding this tool must not lose sight of), and `git blame`s every file
those commits touched at HEAD. A debug commit whose SHA still owns surviving
lines has live scaffolding; survivors older than the age threshold fail, younger
ones warn (active-investigation window). Refuses to run on a shallow clone
rather than false-greening against truncated history.

## Why

The `debug` type's safety net was a manual `git log --grep` sweep — advisory,
token-based, and never run on a schedule. A merge-time gate is structurally
wrong for this class: debug commits are SUPPOSED to merge temporarily, so
intentional-temporary and forgotten are indistinguishable at merge time; only
age separates them. The tool's first live run proved both points at once: it
found a 275-day-old detection diagnostic still logging on every message, and
caught a scaffolding-removal PR being itself incomplete — the surviving handler
half contained no greppable "probe" token, so blame-based line ownership found
what token search could not.

## Threshold rationale

`STALE_DEBUG_MAX_AGE_DAYS = 14`. The type's documented lifecycle is add →
diagnose (days) → remove in a cleanup PR, and this project's prod diagnostic
cycles have closed in well under two weeks. At-threshold is warn, strictly-over
is fail, so an active two-week investigation is never red. Zero baseline: the
expected steady state is no live scaffolding at all, so there is no ratchet
file and no drift meta.

## Known limitation — renames

The `diff-tree` call that discovers a debug commit's touched files is pinned
with `--no-renames`, which closes the gap one step earlier than the remaining
limitation below: without it, a debug commit that itself renamed a file (under
`diff.renames=true`) would surface as a rename-descriptor path
("{old => new}.ts") that blame then fails to resolve — a false negative
dependent on ambient git config rather than on anything this repo does.

`--no-renames` has a second-order cost worth naming, since it shares this
root cause. Without rename detection git reports a rename as a full delete of
the old path plus a full add of the new one, each counted at the file's whole
length, rather than as a small rename-plus-delta. A debug commit that both
renamed and edited a file could therefore shift `numstat.added` against
`numstat.deleted` far enough to flip the `added >= deleted` adding-commit
classification, in either direction depending on file size. Untested by
construction: a fake git runner cannot produce real rename-detection output,
so the test pins the flags rather than the arithmetic. Accepted because
rename-plus-edit is not a debug-instrumentation shape — scaffolding is added
and removed in place.

What survives is the LATER case: survivorship blames the paths a debug commit
ITSELF touched at the time of that commit. If such a file is renamed by a
DIFFERENT, later commit while the scaffolding is still live, blame on the old
path fails as "no such path" — indistinguishable from full removal, a silent
false negative. Accepted for v1: it requires a rename of a file carrying live
scaffolding inside the ≤14-day window before the audit flags it, the per-branch
token grep remains the first line of defense, and rename-following
(`git log --follow` per file) would multiply the tool's git traffic for a rare
case. Revisit if a renamed survivor is ever caught by hand.

## Decay check

The canary synthesizes a throwaway git repo with a backdated `debug(scope): add`
commit whose lines survive at HEAD and asserts the tool fails with findings —
exercising the real git plumbing (log/numstat/blame), not a mock. If the grep
anchor, the numstat net-direction filter, or the blame token parsing rots, the
canary goes red. The shallow-clone guard protects the weekly-audit runner
(which must check out with `fetch-depth: 0`); if that checkout regresses to
shallow, the tool throws loudly and `ops health` reports it BROKEN instead of
green.
