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

export {
  buildShellPlaceholderPersonaName,
  getOrCreateUserService,
  type ProvisionedUser,
  UserService,
} from './UserService.js';
export { resolveRoutingContext, type RoutingContextDeps } from './RoutingContextResolver.js';
export { type PersonaPromptData, PersonaResolver } from './resolvers/index.js';
export { PersonalityService } from './personality/index.js';
