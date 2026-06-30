# Ack-first lint rule — redesign to `no-bare-ack-after-async`

_Distilled from a 3-model council pass (GLM 5.2, Kimi K2.7-code, Qwen 3.7 Max) after a PR review surfaced a coverage gap in the first implementation._

## The problem

The first cut of `@tzurot/component-handler-ack-first` (PR #1409, parked as draft) enforces the Discord 3-second rule by detecting handlers that **own a direct `interaction.<ackMethod>()` call** and firing when async work precedes it. A PR review found a blind spot: handlers whose **only** ack goes through a wrapper helper (`ackWithTimeoutCatch` / `showModalWithTimeoutCatch`) are **never checked at all**.

### Why the blind spot exists

The rule's delegation exemption (an awaited call that passes the whole `interaction` to a callee) was added to kill false positives on delegating routers and ack-wrappers. But "exempt from being flagged as pre-ack work" silently also meant "never marks `ownsAck`." So a wrapper-ack handler has `ownsAck = false` for its whole body → the report condition (`ownsAck && firstMeaningfulAwait !== ack`) never trips → the handler is skipped. Killing the false positives opened a false negative.

This matters because the wrapper-ack family is exactly the "must inspect data before choosing the ack shape" pattern (modals with prefilled fields): `detailModals.ts handleEditButton`, `deny/detailEdit.ts handleEdit`, `SettingsDashboardHandler.handleEditButton`. For this family **ack-first is impossible by construction** — you must fetch the data to know the modal's contents — so the timeout-catch wrapper IS the accepted mitigation, not ack-first ordering.

## The reframe (council consensus)

Stop trying to enforce "ack first" (impossible for the wrapper family). Enforce a single unified invariant that covers both families:

> **A _bare_ initial-ack must not follow async work.**

| Situation                                          | Verdict | Fix                          |
| -------------------------------------------------- | ------- | ---------------------------- |
| ack with **no** preceding async                    | PASS    | —                            |
| async work → **wrapped** ack (`*WithTimeoutCatch`) | PASS    | — (accepted mitigation)      |
| async work → **bare** `interaction.<ackMethod>()`  | FAIL    | hoist the ack **or** wrap it |

The fix differs by family (direct-ack: hoist; wrapper-ack: wrap), but the **failure state is identical**, so one rule with one message is cleaner than two.

This also resolves the reviewer's "make delegation set `ownsAck`" suggestion correctly: under the old "ack must be first" logic that would false-flag the wrapper family; under "bare ack must not follow async," a wrapped late ack legitimately passes.

## Decisions

1. **One unified rule**, renamed to reflect the real invariant (e.g. `no-bare-ack-after-async`). (Qwen + Kimi; GLM preferred two rules but the identical-failure-state argument + 2:1 majority win.)
2. **Out of scope: "handler does async then never acks at all."** That's an _existence_ check, not _ordering/wrapping_; it needs reachability analysis and is FP-prone on branches/early-returns/delegations. If ever wanted, a separate optional `require-interaction-ack` rule — not this one.
3. **Wrapper detection: `*WithTimeoutCatch` suffix convention** (primary — zero-config, self-documenting, lexical; both existing helpers already match), **plus a small config allowlist** as an escape hatch for any wrapper that can't follow the suffix. No type-aware linting (slow, fragile, overkill for a solo monorepo).

## Implementation sketch (redo of PR #1409's rule)

For each detected handler (router key or `(Button|SelectMenu|ModalSubmit)Interaction` param):

1. Walk the body in source order, tracking whether an `await` of **real async work** has occurred (an await that is NOT itself an ack and NOT a wrapped-ack call).
2. On encountering an **initial-ack** call:
   - **Bare** (`interaction.<ackMethod>()`, ackMethods = deferUpdate/deferReply/reply/update/showModal — NOT followUp/editReply): if real async preceded it → **report**.
   - **Wrapped** (callee identifier matches `/WithTimeoutCatch$/` or the allowlist, with `interaction` passed in): always PASS; stop checking (the handler is acked).
3. No ack + no async, or async-only with no ack → PASS (out of scope per decision 2).

Branch-sensitivity caveat (also raised in review): the current rule is single-pass source-order, so a `deferUpdate()` inside `if (!isModalAction)` is seen before the modal branch's `getSession`. The redesign should at minimum not _mis_-credit a branch-local ack to a sibling branch; full per-branch flow analysis is a stretch goal, not a v1 requirement.

## Findings during implementation (the redesign is NOT behavior-neutral)

The redesign was first assumed to be a behavior-neutral clarity refactor — empirical probes showed the OLD rule already caught `fetch → bare-ack` and passed `fetch → wrapper-ack`. **That assumption was wrong.** Once implemented and run across bot-client, the new model flagged ~20 sites where the old rule flagged 1.

Root cause: the old rule's `firstMeaningfulAwait` was set ONCE, at the first non-delegation await. If that first await was itself an ack — e.g. an early sync-guard `reply()` — the slot was "claimed as an ack" and the rule stopped looking. Any LATER `realAsync → bare-ack` was masked. The old rule was silently **capping enforcement to the first await.** The new cumulative `sawRealAsync` model removes that cap, which is why "behavior-neutral" became a ~20-site sweep.

Confirmed real bug the old rule (and PR #1408) missed: `handleSettingsModal` does `getSession` (Redis, line ~476) before its `deferUpdate` (line ~527) on the normal modal-submit path — masked because an earlier `settingId`-guard `reply()` claimed the first-await slot.

### Detection-gap fix (removes a FP class)

`passesInteractionToCallee` originally only recognized the interaction passed as a DIRECT identifier arg (`fn(interaction)`). The dashboard helpers pass it inside an options object (`fetchOrCreateSession({ entityId, interaction })`), so ack-capable delegations read as "real async" and false-flagged the following reply. Fixed by also scanning one-level `ObjectExpression` properties for the interaction identifier. (`interaction.user.id` — a member, not the identifier — still correctly reads as extracted DATA.)

## Status

**Decision (user): commit to the full stricter sweep.** The stricter rule is genuinely better (it found a real bug #1408 missed), so the plan is: fix the detection gap (done), triage the ~20 flags into real-bugs vs branch-leak FPs, remediate the real bugs with the #1408 ack-first pattern (`deferUpdate`/`deferReply` first; error paths → `followUp`; re-renders → `editReply`) across the affected files (grouped into PRs), and land the strict rule (#1409) only once the codebase is clean. Branch-leak FPs (e.g. `detailActionRouter`'s cross-switch-case `sawRealAsync` leak) get a justified `eslint-disable` at the relocated report line.
