/**
 * Shared user helpers for all user route modules
 *
 * Canonical location for getOrCreateInternalUser, used by persona,
 * personality, channel, and other route modules.
 */

import { UserService, type PrismaClient } from '@tzurot/common-types';

/**
 * Get or create internal user from Discord ID.
 *
 * HTTP routes don't have Discord username context (auth middleware only passes
 * the discordId), so this creates a **shell user** — User record only, no
 * default persona. The persona is populated later when the user interacts via
 * the bot-client path, which has the real Discord username and can call
 * {@link UserService.getOrCreateUser} with full context (name, displayName, bio).
 *
 * Previously this method passed `discordUserId` as the username argument to
 * `UserService.getOrCreateUser`, which baked the raw Discord snowflake into
 * `Persona.name` and `Persona.preferredName` — later rendering as the user's
 * identity in system prompts. See the identity-provisioning incident write-up
 * in `docs/incidents/` for the full history.
 *
 * Returns both `id` and `defaultPersonaId`. Callers that require a persona
 * (e.g., for persona CRUD operations) must handle the null case — this can
 * happen if the user has only interacted via HTTP routes and not via Discord.
 */
export async function getOrCreateInternalUser(
  prisma: PrismaClient,
  discordUserId: string
): Promise<{ id: string; defaultPersonaId: string | null }> {
  const userService = new UserService(prisma);

  // Shell creation only — we don't have username context here.
  // Persona backfill happens via bot-client's interaction path.
  const userId = await userService.getOrCreateUserShell(discordUserId);

  if (userId === null) {
    // getOrCreateUserShell returns null only for bots; shouldn't happen via HTTP
    throw new Error('Cannot create user for bot');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, defaultPersonaId: true },
  });

  if (user === null) {
    throw new Error('User not found after creation');
  }

  return user;
}
