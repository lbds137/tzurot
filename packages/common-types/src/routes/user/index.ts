/**
 * User-audience route registry (composed).
 *
 * Four source files contribute:
 *   - configs.ts: timezone, LLM/TTS config + overrides, model override, STT override
 *   - ownership.ts: personality, persona, persona-override CRUD
 *   - resources.ts: channel, wallet, voice resolution, voices CRUD,
 *     usage, NSFW, history
 *   - diagnostics.ts: /diagnostic/* GETs (acceptsSubject for owner inspection)
 *
 * Split is purely a max-lines / max-imports concern; semantically it is
 * one user manifest. The merged `userRoutes` is what the central manifest
 * (routes/manifest.ts) imports.
 *
 * Mounted at `/api/user/*` after the route-prefix cutover. The generated
 * `UserClient` requires `actor: ActorDiscordId` on every method.
 *
 * Domains NOT yet in the manifest (follow-up commits on this branch):
 * memory, shapes, config-overrides (resolve/set), personality-config-overrides,
 * memoryIncognito. Those still need their handlers added here.
 */

import type { RouteDef } from '../types.js';
import { userConfigRoutes } from './configs.js';
import { userOwnershipRoutes } from './ownership.js';
import { userResourceRoutes } from './resources.js';
import { userDiagnosticRoutes } from './diagnostics.js';

export const userRoutes = {
  ...userConfigRoutes,
  ...userOwnershipRoutes,
  ...userResourceRoutes,
  ...userDiagnosticRoutes,
} as const satisfies Record<string, RouteDef>;

/** User-route ID union — used as a manifest key by generated clients. */
export type UserRouteId = keyof typeof userRoutes;

// Re-export the sub-manifests so tests + future tooling can inspect them
// individually (e.g., assert which file contributed which route id).
export { userConfigRoutes, userOwnershipRoutes, userResourceRoutes, userDiagnosticRoutes };
