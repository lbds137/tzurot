/**
 * Gateway Context Types
 *
 * Cross-service contract for the Discord user context that bot-client
 * attaches to every api-gateway HTTP request (as `X-User-Id`,
 * `X-User-Username`, `X-User-DisplayName` headers).
 *
 * Consumers:
 * - bot-client constructs `GatewayUser` from Discord interaction/message
 *   objects via its local `toGatewayUser(DiscordUser)` helper.
 * - api-gateway middleware reads the headers and reconstructs `GatewayUser`
 *   for provisioning (Identity Epic Phase 5c PR B).
 *
 * Keeping the type in common-types means both sides agree on field names
 * and semantics by compile-time contract, not convention.
 */

/**
 * Discord user context carried on every bot-client → api-gateway request.
 *
 * - `discordId`: Discord snowflake (digits only). Safe to send raw as a
 *   Latin-1 HTTP header value.
 * - `username`: Discord username. MUST be URI-encoded on the wire; Node
 *   `fetch` rejects non-Latin-1 header values synchronously.
 * - `displayName`: `globalName ?? username`. Same encoding requirement.
 *
 * On the gateway side, decode `username` and `displayName` with
 * `decodeURIComponent` before using them.
 */
export interface GatewayUser {
  discordId: string;
  username: string;
  displayName: string;
}
