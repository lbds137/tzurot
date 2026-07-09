/**
 * User-audience route registry (composed).
 *
 * Seven source files contribute:
 *   - configs.ts: timezone, LLM/TTS config + overrides, model override, STT override
 *   - ownership.ts: personality, persona, persona-override CRUD
 *   - resources.ts: channel, wallet, voice resolution, voices CRUD,
 *     usage, NSFW, history
 *   - memory.ts: memory CRUD + incognito mode
 *   - config-overrides.ts: user-tier + personality-tier config cascade overrides
 *   - shapes.ts: shapes.inc BYOK (credentials, listing, async import/export)
 *   - diagnostics.ts: /diagnostic/* GETs (acceptsSubject for owner inspection)
 *
 * Split is purely a max-lines / max-imports concern; semantically it is
 * one user manifest. The merged `userRoutes` is what the central manifest
 * (routes/manifest.ts) imports.
 *
 * Mounted at `/api/user/*` after the route-prefix cutover. The generated
 * `UserClient` requires `actor: ActorDiscordId` on every method.
 *
 * Domains NOT yet in the manifest (follow-up commits / future PR):
 * memory main CRUD (dynamic-filter routes — needs more design).
 */

import type { RouteDef } from '../types.js';
import { userConfigRoutes } from './configs.js';
import { userOwnershipRoutes } from './ownership.js';
import { userResourceRoutes } from './resources.js';
import { userMemoryRoutes } from './memory.js';
import { userFactRoutes } from './facts.js';
import { userConfigOverrideRoutes } from './config-overrides.js';
import { userShapesRoutes } from './shapes.js';
import { userDiagnosticRoutes } from './diagnostics.js';

export const userRoutes = {
  ...userConfigRoutes,
  ...userOwnershipRoutes,
  ...userResourceRoutes,
  ...userMemoryRoutes,
  ...userFactRoutes,
  ...userConfigOverrideRoutes,
  ...userShapesRoutes,
  ...userDiagnosticRoutes,
} as const satisfies Record<string, RouteDef>;
// Re-export the sub-manifests so tests + future tooling can inspect them
// individually (e.g., assert which file contributed which route id).
export {
  userConfigRoutes,
  userOwnershipRoutes,
  userResourceRoutes,
  userMemoryRoutes,
  userFactRoutes,
  userConfigOverrideRoutes,
  userShapesRoutes,
  userDiagnosticRoutes,
};
