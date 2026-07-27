/**
 * @tzurot/clients — typed HTTP clients + route manifest for the gateway API.
 *
 * Holds the declarative ROUTE_MANIFEST (consumed by the codegen tool and the
 * generated client classes) plus the transport layer and the generated
 * `UserClient` / `OwnerClient` / `ServiceClient`. Depends one-way on
 * `@tzurot/common-types` for the contract schemas, constants, and domain types
 * the manifest and transport reference.
 */

// Route manifest types — branded ActorDiscordId/SubjectDiscordId, smart
// constructors, RouteDef descriptor.
export {
  type ActorDiscordId,
  asActor,
  type Audience,
  resolveQueryShape,
  type RouteDef,
} from './routes/types.js';
// Internal-audience route registry (service-to-service endpoints).
export { internalRoutes } from './routes/internal.js';
// Admin-audience route registry (bot-owner-only endpoints).
export { adminRoutes } from './routes/admin.js';
// User-audience route registry (any-authenticated-user endpoints).
export { userRoutes } from './routes/user/index.js';
// Central route manifest registry — composes all three audiences.
export { ROUTE_MANIFEST } from './routes/manifest.js';
// Shared gateway client transport + error helpers.
export { GatewayApiError, type GatewayFailureKind } from './clients/errors.js';
export { type GatewayResult } from './clients/transport.js';
// InfraError + result-collapse helpers (distinguish a genuine 404 from an
// infrastructure failure when consuming a GatewayResult).
export {
  GatewayClientError,
  InfraError,
  isInfraFailure,
  nullOn404,
} from './clients/resultHelpers.js';
// Generated client classes — re-exported from the package entry point so
// downstream consumers (bot-client) can import them without reaching into
// _generated/ paths.
export { ServiceClient } from './clients/_generated/service-client.js';
export { OwnerClient } from './clients/_generated/owner-client.js';
export { UserClient } from './clients/_generated/user-client.js';
