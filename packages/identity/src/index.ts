/**
 * @tzurot/identity
 *
 * Prisma-backed identity / provisioning services: users, personas, personalities,
 * and the routing-context resolution that ties them together. Extracted from
 * `@tzurot/common-types` so the shared type package stays types/schemas/utils.
 *
 * Per the epic's boundary principle, the LOGIC lives here; shared data SHAPES
 * (e.g. `LoadedPersonality`, config mappers, the `ConversationMessage`/
 * `PersonaResolverLike` contracts) stay in `@tzurot/common-types`. Consumers
 * construct these services with an injected `PrismaClient` (the apps own their
 * client — see `createPrismaClient` in `@tzurot/common-types`).
 */

export * from './UserService.js';
export * from './RoutingContextResolver.js';
export * from './resolvers/index.js';
export * from './personality/index.js';
