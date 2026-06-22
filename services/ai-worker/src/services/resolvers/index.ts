/**
 * Configuration Resolvers
 *
 * Re-exports the persona resolver from `@tzurot/identity` for local import
 * convenience. Kept as a thin barrel so ai-worker internals can import from a
 * single local path.
 */

export { PersonaResolver, type PersonaPromptData } from '@tzurot/identity';
