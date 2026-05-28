/**
 * Per-interaction typed gateway clients.
 *
 * `clientsFor(interaction)` is the single boundary where a Discord
 * interaction is turned into branded `ActorDiscordId` + `GatewayUser`
 * inputs for the generated clients. Inside command handlers, never
 * call `asActor` directly — always go through `clientsFor` so the
 * brand is applied once, at the right place.
 *
 * Three flavors:
 * - `serviceClient` — no actor, targets `/api/internal/*`. Singleton-able
 *   because there's no per-call state, but we mint per-interaction for
 *   uniformity with the others.
 * - `ownerClient` — owner-only routes at `/api/admin/*`. Pass `subject`
 *   on `acceptsSubject` routes (e.g., denylist add).
 * - `userClient` — user-callable routes at `/api/user/*`. Always carries
 *   the full Discord user context (id + username + displayName) so the
 *   gateway can provision the row + apply per-user filters.
 */

import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  User as DiscordUser,
} from 'discord.js';
import {
  getConfig,
  asActor,
  ServiceClient,
  OwnerClient,
  UserClient,
  type ActorDiscordId,
  type GatewayUser,
} from '@tzurot/common-types';
import { getValidatedServiceSecret } from '../startup.js';
import { toGatewayUser } from './userGatewayClient.js';

/**
 * Union of every Discord interaction shape that carries a `user`.
 * `MessageComponentInteraction` is the base class for `ButtonInteraction`
 * and `StringSelectMenuInteraction`, so both are covered without
 * enumerating them. The factory only reads `interaction.user`, which is
 * defined on the base.
 */
export type ClientCarryingInteraction =
  | ChatInputCommandInteraction
  | MessageComponentInteraction
  | ModalSubmitInteraction;

/**
 * All three clients are minted eagerly even when a caller only needs
 * one — the constructors are cheap (no I/O, no shared mutable state),
 * just config + brand assignment. Lazy initialization would add more
 * code surface than it saves work.
 */
export interface BoundGatewayClients {
  readonly serviceClient: ServiceClient;
  readonly ownerClient: OwnerClient;
  readonly userClient: UserClient;
  readonly actor: ActorDiscordId;
  readonly user: GatewayUser;
}

function getGatewayBaseUrl(): string {
  // The Zod schema for GATEWAY_URL transforms missing/empty values to a
  // localhost default, so config.GATEWAY_URL is typed as `string` (never
  // undefined). The length-0 check stays as defense in depth against a
  // future schema change that drops the localhost fallback.
  const url = getConfig().GATEWAY_URL;
  if (url.length === 0) {
    throw new Error('GATEWAY_URL is not configured');
  }
  return url;
}

function buildClients(discordUser: DiscordUser): BoundGatewayClients {
  const baseUrl = getGatewayBaseUrl();
  const serviceSecret = getValidatedServiceSecret();
  const actor = asActor(discordUser.id);
  const user = toGatewayUser(discordUser);

  return {
    serviceClient: new ServiceClient({ baseUrl, serviceSecret }),
    ownerClient: new OwnerClient({ baseUrl, serviceSecret, actor }),
    userClient: new UserClient({ baseUrl, serviceSecret, actor, user }),
    actor,
    user,
  };
}

/**
 * Build the typed clients for a Discord interaction. Mints the actor
 * brand exactly once; downstream handlers never construct clients
 * themselves.
 */
export function clientsFor(interaction: ClientCarryingInteraction): BoundGatewayClients {
  return buildClients(interaction.user);
}
