---
id: TASK-1028
title: Trim the embed no-content diagnostic once a Components-V2 capture lands
status: To Do
assignee: []
created_date: '2026-09-20 21:41'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: medium
ordinal: 1023000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: `logEmptyEmbedShape` in `services/bot-client/src/utils/embedShapeDiagnostics.ts` logs two things that have DIFFERENT lifecycles, and only one of them is temporary.

Permanent, keep: the fact that an embed rendered no content at all. That condition means a character cannot see something a user shared, which is worth knowing about for as long as embeds exist. It is observability, not instrumentation.

Temporary, trim when its question is answered: the component-tree summary (`componentCount` plus the per-component `{type, childCount, childTypes}` shapes). It exists for ONE purpose — to establish where discord.js surfaces a Components-V2 Container tree for an AUTO-GENERATED link unfurl, which TASK-1024 records as inferred and not yet observed. One prod capture settles it, after which the tree summary is noise on every occurrence.

This is why the unit shipped as a single `fix:` commit rather than a `debug:` plus `fix:` pair. The split `05-tooling.md` describes was not cleanly achievable: the diagnostic call sits inside `formatEmbedElement`, a function the fix itself introduces, so any two-commit split would require hand-constructing an intermediate state that never runs its own gates. And the `debug` type is for instrumentation that gets removed whole, which mischaracterises a hook that is half permanent.

Retirement coupling, which is the part that must not be discovered later: deleting the diagnostic call orphans the `message?` parameter on `EmbedParser.formatEmbedElement`, and `noUnusedParameters` is enforced, so typecheck HARD-FAILS until the two live call sites also drop their 4th argument. Grep `formatEmbedElement(` in `EmbedParser.ts` and `MessageContentBuilder.ts`. The retirement cannot be left half-done.

Also folded in, the log-level watch: the marker now fires on every embed whose legacy fields carry only wrapper metadata, which after the step-4 field additions includes any unfurl that lost its content to Components V2. That is a `warn` per occurrence. Verified at authoring time that nothing routes on pino level — `sendAlert` exists only in `GatewayWatchdog.ts` for wedge detection, `ownerChannel` reporting goes through `ErrorChannelReporter` and the explicit schedulers, and `packages/common-types/src/utils/logger.ts` has no level hooks — so the cost is Railway log volume, not owner interrupts. If prod volume turns out high, drop to `info` at the same time as the trim.

Promote when: a prod log line from EmbedShapeDiagnostics carries a non-empty `components` array, OR TASK-1024 step 2 (the Container renderer) is picked up.

Acceptance: the component-tree summary is gone from the log payload; the no-content fact still logs; `message?` and both 4th arguments are removed together and typecheck passes; the log level is reconsidered against observed prod volume and the decision recorded.

FOLDED IN from the PR #2459 claude-review round, because it is the same volume question from a second angle rather than a separate item: the component-tree summary is recomputed and logged once PER EMBED, not once per message. A message carrying several metadata-only embeds — several vxreddit links posted together, which is an ordinary thing to do — emits N identical copies of the same `message.components` summary. Functionally harmless, and it compounds the warn-per-occurrence volume noted above rather than being independent of it.

Not fixed in that PR on merit rather than on scope: batching means hoisting the diagnostic out of `formatEmbedElement`, which is per-embed by construction, up to the two call sites that hold a live message — and those two are exactly the sites the trim below will be editing anyway. Doing it now would restructure the call shape twice.

Fold it into the trim: whatever replaces the per-embed component summary should be emitted once per message. Note that the per-embed EMBED-shape half (`embedKeys`, `embedType`) is genuinely per-embed and must stay that way — only the message-level component tree is the duplicated part.
<!-- SECTION:DESCRIPTION:END -->
