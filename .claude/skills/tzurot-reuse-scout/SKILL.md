---
name: tzurot-reuse-scout
description: 'Pre-write reuse scouting + drifted-duplicate consolidation. Invoke with /tzurot-reuse-scout before writing new detection/normalization/resolution logic, or when a bug is found in logic that exists in more than one place.'
lastUpdated: '2026-10-11'
---

# Reuse Scout Procedures

The procedure is the Seyag `reuse-scout` skill (`/reuse-scout`, `seyag:reuse-scout`); load it and follow it. This file holds only the Tzurot bindings. In this repo CPD catches only _literal_ duplication, so semantic drift is invisible to it and the defense stays procedural.

If the seyag plugin is not loaded in this session (a cloud unit or the CI review action may lack it), the pointers below do not resolve: say so, and hand the procedure step to the driver or the owner instead of reconstructing it.

## Decision point 1 — the pre-write scout

Procedure: `seyag:reuse-scout § Moment 1: before writing`. Tzurot bindings:

```bash
pnpm ops xray --format md | grep -iE 'termA|termB|termC'   # every export, cannot be stale
grep -rn "concept" packages/ services/ --include="*.ts" -l
pnpm knip:dead                                              # dormant scaffolding counts as prior art
```

- Shared-utility tables to check first: `04-discord.md` § Shared Utilities, `01-architecture.md` § Autocomplete Utilities.
- The negative-existence rule's Tzurot additions (xray, `knip:dead`): `00-critical.md` § Don't Present Speculation as Fact.
- Found something _almost_ right? Apply the 2-callback ceiling (`02-code-standards.md`) before deciding between extending and writing anew.

## Decision point 2 — the consolidation sweep

Procedure: `seyag:reuse-scout § Moment 2: a bug in duplicated logic`. Tzurot bindings:

- Enumerate copies with xray/grep by behavior keywords.
- The single source of truth is e.g. a `common-types` helper or one resolver; registries are `as const` tables.
- `pnpm ops guard:duplicate-exports` catches same-name exports only.

## Config-route helpers — scope and boundary

`services/api-gateway/src/utils/configRouteHelpers.ts` + `normalizeConfigNameOnPromote.ts` standardize the CRUD config-route shape: `parseBodyOrSendError`, `findConfigOrSendNotFound`, `findGlobalConfigOrSendError`, `findAdminUserOrSendError`, `ensureNoNameCollision`, `shapeDeleteResponse`, `applyOwnerNamePromotion` (signatures in the file).

**Apply these helpers when:** the route follows the fetch-validate-respond shape over a top-level config row (LlmConfig, TtsConfig, similar future resources).

**Do NOT apply these helpers when:** the route uses cascade-override semantics (`user/{tts,stt,model}-override.ts`). Cascade overrides set/clear values on a personality-scoped key — a fundamentally different domain shape than CRUD. Forcing CRUD helpers there is the Wrong Abstraction trap.

## Boundary

Procedure: `seyag:reuse-scout § Boundary`. Tzurot binding: duplicated _skeleton shape_ (standardized call sites of a shared helper) is deliberately excluded by the CPD post-filter.
