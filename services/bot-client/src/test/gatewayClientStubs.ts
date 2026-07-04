/**
 * Shared test helpers for stubbing the generated gateway clients.
 *
 * Used by command tests that mock `clientsFor(interaction)` to return a
 * stubbed `UserClient` / `OwnerClient` / `ServiceClient` instead of the
 * real one. Centralizing here keeps the cast trick (`as unknown as UserClient`)
 * out of every test and lets test files only declare the methods they actually
 * exercise.
 */

import type { ApiErrorSubcode } from '@tzurot/common-types/constants/error';
import type {
  GatewayFailureKind,
  GatewayResult,
  OwnerClient,
  ServiceClient,
  UserClient,
} from '@tzurot/clients';

/** Build an `ok` GatewayResult. */
export function makeOk<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

/**
 * Build an `err` GatewayResult with HTTP status + optional message and subcode.
 * `kind` defaults from status (honoring `status > 0 ⟺ kind === 'http'`); pass it
 * explicitly to stub a non-HTTP transport failure (timeout/network/schema/config).
 */
export function makeErr(
  status: number,
  message = 'fail',
  code?: ApiErrorSubcode,
  kind?: GatewayFailureKind
): GatewayResult<never> {
  return {
    ok: false,
    kind: kind ?? (status > 0 ? 'http' : 'network'),
    error: message,
    status,
    ...(code === undefined ? {} : { code }),
  };
}

/**
 * Type-only cast helper. The stub object structurally only implements the
 * subset of methods a given test exercises; this cast makes TypeScript
 * accept it as the full client type without forcing every test to
 * implement all 100+ generated methods.
 */
export function asUserClient<S extends object>(stub: S): UserClient {
  return stub as unknown as UserClient;
}

export function asOwnerClient<S extends object>(stub: S): OwnerClient {
  return stub as unknown as OwnerClient;
}

export function asServiceClient<S extends object>(stub: S): ServiceClient {
  return stub as unknown as ServiceClient;
}
