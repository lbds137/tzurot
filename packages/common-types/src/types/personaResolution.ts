/**
 * Persona Resolution Contracts
 *
 * Minimal cross-boundary shapes for persona resolution. The resolver LOGIC
 * (`PersonaResolver`) lives in `@tzurot/identity`, but a common-types utility
 * (`extendedContextPersonaResolver`) accepts a resolver and reads a couple of
 * fields off the resolved persona. To let it do that without a package cycle
 * (common-types must not depend on the Prisma-backed identity package), the
 * shared contract lives here and identity's richer types extend / satisfy it.
 */

/**
 * The slice of a resolved persona that cross-boundary consumers read.
 * `@tzurot/identity`'s `ResolvedPersona` extends this with the full prompt fields.
 */
export interface CorePersonaConfig {
  /** Persona UUID (empty string when no persona resolved). */
  personaId: string;
  /** User's preferred display name, or null when unset. */
  preferredName: string | null;
}

/**
 * Structural contract for a persona resolver. The real implementation is
 * `@tzurot/identity`'s `PersonaResolver`; this lets common-types utilities
 * accept it by structural typing without importing the identity package.
 */
export interface PersonaResolverLike {
  resolve(userId: string | undefined, contextId?: string): Promise<{ config: CorePersonaConfig }>;
}
