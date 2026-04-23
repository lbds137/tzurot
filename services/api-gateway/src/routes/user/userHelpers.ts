/**
 * Shared user helpers for all user route modules
 *
 * Canonical location for getOrCreateInternalUser, used by persona,
 * personality, channel, and other route modules.
 */

import { type PrismaClient } from '@tzurot/common-types';
import { getOrCreateUserService } from '../../services/AuthMiddleware.js';
import type { ProvisionedRequest } from '../../types.js';

/**
 * Get or create internal user for an HTTP-route handler.
 *
 * Prefers the fully-provisioned `{ userId, defaultPersonaId }` attached by the
 * `requireProvisionedUser` middleware when bot-client passed the
 * `X-User-Username` / `X-User-DisplayName` headers. Falls back to the legacy
 * shell path (`UserService.getOrCreateUserShell`) when the middleware shadow-
 * mode fell through — missing / malformed headers, bot users, or rare
 * `getOrCreateUser` failures. Once the middleware is tightened to return 400
 * on missing provisioning, the fallback branch disappears.
 *
 * Historical note: the shell path existed because HTTP routes didn't originally
 * carry Discord username context, so `Persona.name` / `Persona.preferredName`
 * couldn't be populated. Passing the raw discord snowflake as the username
 * argument baked the snowflake into those fields — which later rendered as the
 * user's identity in system prompts. See `docs/incidents/` for the full
 * Phase 5 write-up. The fallback here calls `getOrCreateUserShell`, which
 * intentionally does NOT touch the persona name for that reason.
 *
 * Returns both `id` and `defaultPersonaId`. Callers that require a persona
 * (e.g., for persona CRUD operations) must handle the null case — this can
 * happen for shell-path users that haven't yet interacted via Discord.
 */
export async function getOrCreateInternalUser(
  prisma: PrismaClient,
  req: ProvisionedRequest
): Promise<{ id: string; defaultPersonaId: string | null }> {
  // Common path: middleware provisioned successfully, both UUIDs already on req.
  if (req.provisionedUserId !== undefined) {
    return {
      id: req.provisionedUserId,
      defaultPersonaId: req.provisionedDefaultPersonaId ?? null,
    };
  }

  // Shadow-mode fallthrough: create shell and look up the persona separately.
  const userService = getOrCreateUserService(prisma);
  const userId = await userService.getOrCreateUserShell(req.userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, defaultPersonaId: true },
  });

  if (user === null) {
    throw new Error(`User not found after creation (userId=${userId}, discordId=${req.userId})`);
  }

  return user;
}
