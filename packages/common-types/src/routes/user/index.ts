/**
 * User-audience route registry (composed).
 *
 * Two source files contribute:
 *   - configs.ts: timezone, LLM/TTS config + overrides, model override, STT override
 *   - resources.ts: personality, persona, channel, wallet, voice resolution, diagnostics
 *
 * Split is purely a max-lines / max-imports concern; semantically it is
 * one user manifest. The merged `userRoutes` is what the central manifest
 * (in routes/manifest.ts, future commit) imports.
 *
 * Mounted at `/api/user/*` after the route-prefix cutover. The generated
 * `UserClient` requires `actor: ActorDiscordId` on every method.
 *
 * Domains NOT yet in the manifest (follow-up commits on this branch):
 * memory, history, shapes, voices CRUD, config-overrides (resolve/set),
 * nsfw, usage. Those need Zod response schemas hand-written first.
 */

import type { RouteDef } from '../types.js';
import { userConfigRoutes } from './configs.js';
import { userResourceRoutes } from './resources.js';

export const userRoutes = {
  ...userConfigRoutes,
  ...userResourceRoutes,
} as const satisfies Record<string, RouteDef>;

/** User-route ID union — used as a manifest key by generated clients. */
export type UserRouteId = keyof typeof userRoutes;

// Re-export the sub-manifests so tests + future tooling can inspect them
// individually (e.g., assert which file contributed which route id).
export { userConfigRoutes, userResourceRoutes };
