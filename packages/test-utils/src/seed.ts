/**
 * Integration test seed helpers.
 *
 * Phase 5b introduced a structural invariant: every `users` row MUST have a
 * non-null `default_persona_id` pointing to an existing `personas` row whose
 * `owner_id` equals that user's id. Because the two tables have mutually
 * circular FKs, the only way to create a valid pair is via a single-statement
 * CTE — which is what these helpers encapsulate so tests don't duplicate
 * the SQL.
 *
 * Tests that used to call `prisma.user.create({ data: ... })` with no persona
 * now need `seedUserWithPersona` instead. Callers that computed userId via
 * `generateUserUuid(discordId)` should also compute `personaId` via
 * `generatePersonaUuid(personaName, userId)` so the seed is reproducible.
 */

// Structural typing so this package can stay off `@tzurot/common-types` as a
// runtime dependency. The cycle is subtle: common-types is a PRODUCTION peer,
// but its own `.int.test.ts` files consume this package, so common-types
// listing test-utils as a devDependency creates a Turbo build-DAG cycle the
// moment test-utils starts depending on common-types at any level. Breaking
// it cleanly requires either extracting shared constants to a third package
// or dropping test-utils out of common-types's devDeps — both are 5c scope.
interface PrismaExecuteRaw {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
}

export interface SeedUserWithPersonaOptions {
  /** Pre-computed user UUID (e.g., from `generateUserUuid(discordId)`). */
  userId: string;
  /** Pre-computed persona UUID (e.g., from `generatePersonaUuid(name, userId)`). */
  personaId: string;
  /** Discord snowflake ID for the user. */
  discordId: string;
  /** Discord username (defaults to `discordId` to match shell-creation semantics). */
  username?: string;
  /** Whether to flag the seeded user as a superuser. Defaults to `false`. */
  isSuperuser?: boolean;
  /**
   * Persona `name` column. Must not be a bare Discord snowflake (violates the
   * `personas_name_not_snowflake` CHECK constraint). Defaults to
   * `"User {discordId}"` to match shell-creation placeholder semantics.
   */
  personaName?: string;
  /** Persona `preferred_name`. Defaults to the `personaName`. */
  personaPreferredName?: string;
  /** Persona `content` body. Defaults to empty string. */
  personaContent?: string;
  /** Persona `description`. Defaults to 'Default persona'. */
  personaDescription?: string;
}

/**
 * Create a `(users, personas)` pair in one CTE so both FK directions resolve
 * at statement end. Replaces direct `prisma.user.create(...)` calls that used
 * to rely on `default_persona_id` being nullable.
 */
export async function seedUserWithPersona(
  prisma: PrismaExecuteRaw,
  options: SeedUserWithPersonaOptions
): Promise<void> {
  const {
    userId,
    personaId,
    discordId,
    username = discordId,
    isSuperuser = false,
    personaName = `User ${discordId}`,
    personaPreferredName,
    personaContent = '',
    // Mirrors `DEFAULT_PERSONA_DESCRIPTION` in
    // `common-types/src/constants/persona.ts`. Can't import the constant
    // directly — see the comment at the top of this file for why. Keep the
    // two values in sync until Phase 5c breaks the Turbo build-DAG cycle.
    personaDescription = 'Default persona',
  } = options;

  const preferred = personaPreferredName ?? personaName;

  await prisma.$executeRaw`
    WITH new_persona AS (
      INSERT INTO personas (id, name, preferred_name, description, content, owner_id, updated_at)
      VALUES (
        ${personaId}::uuid,
        ${personaName},
        ${preferred},
        ${personaDescription},
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
        ${isSuperuser},
        ${personaId}::uuid,
        NOW()
      )
      RETURNING id
    )
    SELECT 1
  `;
}
