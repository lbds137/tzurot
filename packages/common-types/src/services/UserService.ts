/**
 * UserService
 * Manages User records - creates users on first interaction
 *
 * Key behaviors:
 * - Creates users with default personas atomically via transactions
 * - Handles race conditions when multiple requests arrive for same user
 * - Backfills default personas for legacy users created without them
 * - Updates placeholder usernames (discordId) to real usernames
 */

import type { PrismaClient } from './prisma.js';
import { Prisma } from './prisma.js';
import { createLogger } from '../utils/logger.js';
import { TTLCache } from '../utils/TTLCache.js';
import { generateUserUuid, generatePersonaUuid } from '../utils/deterministicUuid.js';
import { isBotOwner } from '../utils/ownerMiddleware.js';
import { UNKNOWN_USER_DISCORD_ID } from '../constants/message.js';

/**
 * User record with fields needed for post-read maintenance checks.
 *
 * Phase 5b note: `defaultPersonaId` is NOT NULL at both the DB and Prisma-type
 * level, so there is no "null default" branch here. The legacy
 * `backfillDefaultPersona` path existed for users created before the NOT NULL
 * migration; that class of user no longer exists in either the schema or the
 * data (verified zero in dev + prod pre-flight).
 */
interface UserWithBackfillFields {
  id: string;
  isSuperuser: boolean;
  username: string;
  defaultPersonaId: string;
}

/**
 * Return shape for {@link UserService.getOrCreateUser}.
 *
 * Structurally asserts that the user is fully provisioned — both the User
 * row AND its default Persona exist. Callers that only need `userId` should
 * destructure `{ userId }` rather than special-casing any field.
 *
 * This shape is the Phase 2 contract in the Identity & Provisioning Hardening
 * epic: by bundling `defaultPersonaId` non-null into the return type, we move
 * the "does this user have a persona?" invariant out of read-time repair
 * (runMaintenanceTasks) and into the type system.
 */
export interface ProvisionedUser {
  userId: string;
  defaultPersonaId: string;
}

const logger = createLogger('UserService');

/** Default description for auto-created personas */
const DEFAULT_PERSONA_DESCRIPTION = 'Default persona';

/**
 * Build the placeholder persona name used during shell-user creation (Identity
 * Epic Phase 5b). Prefix `"User "` is intentional — the bare Discord snowflake
 * ID would violate the `personas_name_not_snowflake` CHECK constraint added
 * in Phase 5. This placeholder is replaced with the user's real Discord
 * username by `runMaintenanceTasks` on their first bot-client interaction.
 *
 * Exported so tests and any direct callers share the same formula without
 * duplicating the "User " prefix literal.
 */
export function buildShellPlaceholderPersonaName(discordId: string): string {
  return `User ${discordId}`;
}

/** Cache TTL: 1 hour - users rarely change, but we want eventual consistency */
const USER_CACHE_TTL_MS = 60 * 60 * 1000;

/** Max cache size: 10,000 users - prevents unbounded memory growth */
const USER_CACHE_MAX_SIZE = 10_000;

export class UserService {
  /**
   * Cache discordId -> ProvisionedUser with TTL to prevent memory leaks.
   *
   * **Only populated by {@link getOrCreateUser}.** The shell path reads from
   * this cache (and returns `.userId`) but never writes, because a shell-only
   * provisioning doesn't guarantee a non-null `defaultPersonaId`.
   *
   * If `UserService` is ever refactored to a singleton, the shell path's
   * cache-read short-circuits a later `getOrCreateUser` call's persona
   * backfill + username upgrade for the same discordId. Today's per-request
   * instantiation keeps the cache cold, so this is a future-singleton hazard
   * tracked in BACKLOG.md rather than a current bug.
   */
  private userCache: TTLCache<ProvisionedUser>;

  constructor(private prisma: PrismaClient) {
    this.userCache = new TTLCache<ProvisionedUser>({
      ttl: USER_CACHE_TTL_MS,
      maxSize: USER_CACHE_MAX_SIZE,
    });
  }

  /**
   * Get or create a user by Discord ID.
   *
   * Returns a {@link ProvisionedUser} (both `userId` and non-null
   * `defaultPersonaId`) for use in foreign keys. Returns `null` only if the
   * caller identifies the subject as a bot.
   *
   * @param discordId Discord user ID
   * @param username Discord username (e.g., "alt_hime")
   * @param displayName Discord display name (e.g., "Alt Hime") - falls back to username if not provided
   * @param bio Discord user's profile bio/about me - if provided, used for persona content
   * @param isBot Whether the user is a Discord bot - if true, returns null without creating a record
   */
  async getOrCreateUser(
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string,
    isBot?: boolean
  ): Promise<ProvisionedUser | null> {
    // Skip user creation for bots - they shouldn't have user records or personas
    if (isBot === true) {
      logger.debug({ discordId, username }, 'Skipping user creation for bot');
      return null;
    }

    // Check cache first
    const cached = this.userCache.get(discordId);
    if (cached !== null) {
      return cached;
    }

    try {
      // Try to find existing user
      let user: UserWithBackfillFields | null = await this.prisma.user.findUnique({
        where: { discordId },
        select: { id: true, isSuperuser: true, username: true, defaultPersonaId: true },
      });

      // Create if doesn't exist (with race condition handling)
      user ??= await this.createUserWithRaceProtection(discordId, username, displayName, bio);

      // Run maintenance tasks (superuser promotion, placeholder username
      // upgrade) and get the authoritative `defaultPersonaId`.
      const defaultPersonaId = await this.runMaintenanceTasks(user, discordId, username);

      const provisioned: ProvisionedUser = { userId: user.id, defaultPersonaId };
      this.userCache.set(discordId, provisioned);
      return provisioned;
    } catch (error) {
      logger.error({ err: error, discordId }, 'Failed to get/create user');
      throw error;
    }
  }

  /**
   * Get or create a user by Discord ID WITHOUT a default persona.
   *
   * Use this from code paths that don't have a real Discord username available
   * (e.g., api-gateway HTTP routes where auth middleware only passes the
   * discordId). Persona creation is deferred until the user interacts via the
   * bot-client path, which has the real username and can populate a proper
   * Persona via backfillDefaultPersona.
   *
   * This exists because prior to this method, such callers passed the discordId
   * as both the Discord ID AND the username parameter, which baked the raw
   * snowflake into Persona.name and Persona.preferredName — later rendering
   * that snowflake as the user's identity in system prompts instead of their
   * real Discord username. See docs/incidents/ for the full write-up.
   *
   * No bot-filtering is done here (unlike {@link getOrCreateUser}) because
   * HTTP routes authenticate via session/discordId — bots don't hit these
   * endpoints in practice.
   *
   * @param discordId Discord user ID
   * @returns The user's UUID
   */
  async getOrCreateUserShell(discordId: string): Promise<string> {
    const cached = this.userCache.get(discordId);
    if (cached !== null) {
      return cached.userId;
    }

    try {
      const user =
        (await this.prisma.user.findUnique({
          where: { discordId },
          select: { id: true },
        })) ?? (await this.createShellUserWithRaceProtection(discordId));

      // Intentionally NOT populated: this.userCache.set(...).
      // The cache is shared with getOrCreateUser and stores ProvisionedUser
      // (userId + non-null defaultPersonaId). The shell path doesn't guarantee
      // a persona exists yet — persona creation is deferred to the first
      // bot-client call with a real username. Writing here with a synthetic
      // defaultPersonaId would either lie about the invariant or force us to
      // widen the cache type. Omitting the write keeps the invariant "only
      // getOrCreateUser populates the cache" explicit and singleton-safe.
      return user.id;
    } catch (error) {
      logger.error({ err: error, discordId }, 'Failed to get/create user shell');
      throw error;
    }
  }

  /**
   * Create a shell user (no persona) with race condition protection.
   * Username is stored as discordId as a placeholder; it'll be upgraded when
   * the user interacts via bot-client with their real Discord username.
   */
  private async createShellUserWithRaceProtection(discordId: string): Promise<{ id: string }> {
    const userId = generateUserUuid(discordId);
    const shouldBeSuperuser = isBotOwner(discordId);
    // Placeholder persona name — MUST be prefixed (not bare discordId) to
    // pass the `personas_name_not_snowflake` CHECK constraint added in Phase 5.
    // Upgraded to the real Discord username by runMaintenanceTasks on the
    // user's first bot-client interaction.
    const placeholderPersonaName = buildShellPlaceholderPersonaName(discordId);
    const personaId = generatePersonaUuid(placeholderPersonaName, userId);

    try {
      // Phase 5b: users.default_persona_id is NOT NULL and personas.owner_id
      // FKs back to users.id — a circular reference that would break any
      // sequence of standalone INSERTs (neither row can be the first one
      // inserted with complete data). A single-statement CTE sidesteps the
      // bootstrap: Postgres checks IMMEDIATE FK constraints at statement end,
      // by which point both rows exist. NOT NULL on users.default_persona_id
      // is satisfied at row-insert time because we pre-compute personaId from
      // the deterministic UUID formula.
      await this.prisma.$executeRaw`
        WITH new_persona AS (
          INSERT INTO personas (id, name, preferred_name, description, content, owner_id, updated_at)
          VALUES (
            ${personaId}::uuid,
            ${placeholderPersonaName},
            ${placeholderPersonaName},
            ${DEFAULT_PERSONA_DESCRIPTION},
            ${''},
            ${userId}::uuid,
            NOW()
          )
          RETURNING id
        ),
        new_user AS (
          INSERT INTO users (id, discord_id, username, is_superuser, default_persona_id, updated_at)
          VALUES (
            ${userId}::uuid,
            ${discordId},
            ${discordId},
            ${shouldBeSuperuser},
            ${personaId}::uuid,
            NOW()
          )
          RETURNING id
        )
        SELECT 1
      `;
      if (shouldBeSuperuser) {
        logger.info({ userId, discordId }, 'Bot owner auto-promoted to superuser (shell creation)');
      }
      logger.info(
        { userId, discordId, personaId },
        'Created shell user with placeholder default persona'
      );
      return { id: userId };
    } catch (error) {
      // Post-Phase-5b: the transaction writes User + Persona. P2002 can in
      // theory come from either constraint, though in practice only
      // `users.discord_id` can fire here (persona UUIDs are deterministic
      // from discordId and the placeholder name is unique per ownerId by
      // construction). Match on `discord_id` explicitly so future schema
      // changes that add more unique constraints don't silently mis-recover.
      if (this.isPrismaUniqueConstraintError(error, 'discord_id')) {
        return this.fetchExistingUserAfterRace(discordId, { id: true }, error, 'shell');
      }
      throw error;
    }
  }

  /**
   * Create user with race condition protection
   * If two requests try to create the same user simultaneously, one will fail with P2002.
   * We catch that and fetch the existing user instead.
   */
  private async createUserWithRaceProtection(
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string
  ): Promise<UserWithBackfillFields> {
    try {
      return await this.createUserWithDefaultPersona(discordId, username, displayName, bio);
    } catch (error) {
      // P2002 is Prisma's unique constraint violation error
      // Use duck typing to check for Prisma error (safer than instanceof in test environments)
      if (this.isPrismaUniqueConstraintError(error)) {
        return this.fetchExistingUserAfterRace(
          discordId,
          { id: true, isSuperuser: true, username: true, defaultPersonaId: true },
          error,
          'full'
        );
      }
      throw error;
    }
  }

  /**
   * Check if an error is a Prisma unique constraint violation (P2002).
   * Uses duck typing to avoid instanceof issues in test environments.
   *
   * Optionally filter to a specific constraint via `target` — matches substrings
   * in `error.meta.target` (Prisma includes the constraint name/columns there).
   * Callers that just want "any P2002" pass no target. Callers that need to
   * distinguish between multiple possible unique constraints on a transaction
   * (e.g., shell creation now writes User + Persona, each with its own
   * uniqueness) pass a target to match only the expected constraint.
   *
   * Identity Epic Phase 5b added the target parameter as defense-in-depth for
   * the new shell-creation transaction. Future schema changes that add more
   * unique constraints on User/Persona won't silently mis-recover.
   */
  private isPrismaUniqueConstraintError(error: unknown, target?: string): boolean {
    if (
      error === null ||
      typeof error !== 'object' ||
      !('code' in error) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    if (target === undefined) {
      return true;
    }
    // Prisma P2002 errors include `meta.target` — either a string or array of
    // constraint column names. We do a substring match for robustness across
    // both shapes.
    const meta = 'meta' in error ? (error as { meta?: unknown }).meta : undefined;
    if (meta === null || typeof meta !== 'object' || !('target' in meta)) {
      return false;
    }
    const metaTarget = (meta as { target: unknown }).target;
    const serialized = Array.isArray(metaTarget)
      ? metaTarget.join(',')
      : typeof metaTarget === 'string'
        ? metaTarget
        : '';
    return serialized.includes(target);
  }

  /**
   * Recover after a P2002 race — another concurrent request created the user
   * between our findUnique and create. Fetch the now-existing row with the
   * caller's preferred select shape and return it.
   *
   * Shared by both shell and full creation paths. `creationType` is logged as
   * a structured field so the two call sites stay distinguishable in logs.
   */
  private async fetchExistingUserAfterRace<T extends Prisma.UserSelect>(
    discordId: string,
    select: T,
    cause: unknown,
    creationType: 'shell' | 'full'
  ): Promise<Prisma.UserGetPayload<{ select: T }>> {
    logger.warn(
      { discordId, creationType },
      'Race condition detected during user creation, fetching existing user'
    );
    const existingUser = await this.prisma.user.findUnique({
      where: { discordId },
      select,
    });
    if (existingUser === null) {
      // Shouldn't happen — P2002 means the record exists
      throw new Error(`User not found after P2002 error for discordId: ${discordId}`, { cause });
    }
    return existingUser;
  }

  /**
   * Run maintenance tasks for existing users.
   * Handles promoting the bot owner to superuser and upgrading placeholder
   * usernames (shell-path) to real Discord usernames on first bot-client
   * interaction. These are "read-repair" operations that fix pre-hardening
   * data on access.
   *
   * Returns the effective `defaultPersonaId` — always non-null post-Phase-5b.
   */
  private async runMaintenanceTasks(
    user: UserWithBackfillFields,
    discordId: string,
    username: string
  ): Promise<string> {
    // Check if existing user should be promoted to superuser
    await this.promoteToSuperuserIfNeeded(user, discordId);

    // Phase 5b: defaultPersonaId is structurally NOT NULL, so there is no
    // backfill branch anymore. The legacy repair-on-read path that created
    // personas for users missing a default persona has been removed along
    // with the null column.
    const defaultPersonaId = user.defaultPersonaId;

    // Update placeholder username if we now have a real username.
    // Only updates usernames that exactly match discordId (placeholder pattern).
    // This intentionally does NOT sync changed Discord usernames — we preserve
    // the username from first interaction to maintain historical consistency.
    //
    // Identity Epic Phase 5b: also rename the placeholder persona from
    // `"User {discordId}"` to the real username. The rename uses `updateMany`
    // with an idempotent WHERE predicate so concurrent maintenance calls for
    // the same user don't race — the second call matches zero rows and
    // no-ops. The unique `(ownerId, name)` constraint cannot fire here
    // because the placeholder name is unique per owner by construction, and
    // this is the first time the real username has arrived for this user.
    if (user.username === discordId && username !== discordId) {
      const placeholderPersonaName = buildShellPlaceholderPersonaName(discordId);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { username },
      });
      const renameResult = await this.prisma.persona.updateMany({
        where: { ownerId: user.id, name: placeholderPersonaName },
        data: { name: username, preferredName: username },
      });
      logger.info(
        {
          userId: user.id,
          discordId,
          oldUsername: user.username,
          newUsername: username,
          personasRenamed: renameResult.count,
        },
        'Updated placeholder username and renamed shell placeholder persona'
      );
    }

    return defaultPersonaId;
  }

  /**
   * Promote existing user to superuser if they are the bot owner
   * Handles the case where BOT_OWNER_ID is set after user was created
   */
  private async promoteToSuperuserIfNeeded(
    user: UserWithBackfillFields | null,
    discordId: string
  ): Promise<void> {
    if (user && !user.isSuperuser && isBotOwner(discordId)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { isSuperuser: true },
      });
      logger.info({ userId: user.id, discordId }, 'Promoted existing user to superuser');
    }
  }

  /**
   * Create a new user with their default persona in a transaction
   */
  private async createUserWithDefaultPersona(
    discordId: string,
    username: string,
    displayName?: string,
    bio?: string
  ): Promise<UserWithBackfillFields> {
    const userId = generateUserUuid(discordId);
    const personaId = generatePersonaUuid(username, userId);
    const shouldBeSuperuser = isBotOwner(discordId);
    const personaDisplayName = displayName ?? username;
    const personaContent = bio ?? '';

    // Phase 5b: circular-FK bootstrap via single-statement CTE. See the
    // matching comment in createShellUserWithRaceProtection for the reasoning.
    await this.prisma.$executeRaw`
      WITH new_persona AS (
        INSERT INTO personas (id, name, preferred_name, description, content, owner_id, updated_at)
        VALUES (
          ${personaId}::uuid,
          ${username},
          ${personaDisplayName},
          ${DEFAULT_PERSONA_DESCRIPTION},
          ${personaContent},
          ${userId}::uuid,
          NOW()
        )
        RETURNING id
      ),
      new_user AS (
        INSERT INTO users (id, discord_id, username, is_superuser, default_persona_id, updated_at)
        VALUES (
          ${userId}::uuid,
          ${discordId},
          ${username},
          ${shouldBeSuperuser},
          ${personaId}::uuid,
          NOW()
        )
        RETURNING id
      )
      SELECT 1
    `;

    if (shouldBeSuperuser) {
      logger.info({ userId, discordId, username }, 'Bot owner auto-promoted to superuser');
    }
    logger.info({ userId, discordId, username, personaId }, 'Created user with default persona');

    return {
      id: userId,
      isSuperuser: shouldBeSuperuser,
      username,
      defaultPersonaId: personaId,
    };
  }

  /**
   * Get user's timezone preference
   * @param userId User's internal UUID
   * @returns User's timezone (IANA format) or 'UTC' if not set
   */
  async getUserTimezone(userId: string): Promise<string> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { timezone: true },
      });
      return user?.timezone ?? 'UTC';
    } catch (error) {
      logger.error({ err: error }, `Failed to get timezone for user ${userId}`);
      return 'UTC'; // Default to UTC on error
    }
  }

  /**
   * Get persona name by ID
   * @param personaId Persona UUID
   * @returns Persona name (preferredName if set, otherwise name)
   */
  async getPersonaName(personaId: string): Promise<string | null> {
    try {
      const persona = await this.prisma.persona.findUnique({
        where: { id: personaId },
        select: {
          name: true,
          preferredName: true,
        },
      });

      if (!persona) {
        return null;
      }

      return persona.preferredName ?? persona.name;
    } catch (error) {
      logger.error({ err: error }, `Failed to get persona name for ${personaId}`);
      return null;
    }
  }

  /**
   * Get or create multiple users in batch
   * Used for extended context participants to ensure proper personas exist
   *
   * Filters out:
   * - Bots (isBot: true)
   * - Unknown users (discordId === UNKNOWN_USER_DISCORD_ID) from forwarded messages
   *
   * @param users - Array of user info from extended context
   * @returns Map of discordId to userId (UUID), excluding filtered users
   */
  async getOrCreateUsersInBatch(
    users: {
      discordId: string;
      username: string;
      displayName?: string;
      isBot: boolean;
    }[]
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    // Filter out bots and unknown users
    const validUsers = users.filter(u => !u.isBot && u.discordId !== UNKNOWN_USER_DISCORD_ID);

    if (validUsers.length === 0) {
      return result;
    }

    // Process in batches of 10 to avoid overwhelming the database
    const BATCH_SIZE = 10;
    for (let i = 0; i < validUsers.length; i += BATCH_SIZE) {
      const batch = validUsers.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const batchResults = await Promise.all(
        batch.map(async user => {
          try {
            const provisioned = await this.getOrCreateUser(
              user.discordId,
              user.username,
              user.displayName,
              undefined, // bio
              user.isBot
            );
            // Batch API returns `Map<string, string>` (discordId → userId);
            // `defaultPersonaId` from ProvisionedUser is intentionally dropped
            // here because batch callers only need the userId for foreign-key
            // linking. If a caller ever needs the persona id, they should call
            // `getOrCreateUser` directly rather than widening this batch API.
            return { discordId: user.discordId, userId: provisioned?.userId ?? null };
          } catch (error) {
            // Log but don't fail the entire batch for one user
            logger.warn(
              { err: error, discordId: user.discordId },
              'Failed to get/create user in batch, continuing with others'
            );
            return { discordId: user.discordId, userId: null };
          }
        })
      );

      // Collect successful results
      for (const { discordId, userId } of batchResults) {
        if (userId !== null) {
          result.set(discordId, userId);
        }
      }
    }

    logger.debug(
      { requested: validUsers.length, created: result.size },
      'Batch user creation completed'
    );

    return result;
  }
}
