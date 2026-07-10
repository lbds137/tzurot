/**
 * Memory Facts API Client
 * API functions for the /memory facts surface (memory Phase 2 correction slice).
 *
 * CONTRACT (mirrors detailApi.ts): `null` (or `false` for forget) means
 * DEFINITIVELY absent — a genuine 404. Every other failure THROWS
 * (`InfraError` for transport/5xx, `GatewayClientError` for a non-404 4xx,
 * including the 403 a locked fact returns on correct/forget) so callers can
 * classify honestly via `classifyGatewayFailure`.
 */

import { type z } from 'zod';
import {
  type FactItemSchema,
  type FactListResponseSchema,
} from '@tzurot/common-types/schemas/api/fact';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { nullOn404, type GatewayResult, type UserClient } from '@tzurot/clients';

const logger = createLogger('memory-facts-api');

export type FactItem = z.infer<typeof FactItemSchema>;
export type FactListResponse = z.infer<typeof FactListResponseSchema>;

/** Log non-404 failures before nullOn404 throws (observability parity). */
function warnNonMiss(
  result: GatewayResult<unknown>,
  context: Record<string, unknown>,
  message: string
): void {
  if (!result.ok && result.status !== 404) {
    logger.warn({ ...context, kind: result.kind, status: result.status }, message);
  }
}

/**
 * Fetch a page of active facts for a personality. `null` = fetch failed
 * (list is a read; the browse view degrades to a transient-error message
 * rather than classifying, matching the episode browse contract).
 */
export async function fetchFacts(
  userClient: UserClient,
  personalityId: string,
  offset: number,
  limit: number
): Promise<FactListResponse | null> {
  const result = await userClient.listFacts({
    personalityId,
    limit: limit.toString(),
    offset: offset.toString(),
  });
  if (!result.ok) {
    return null;
  }
  return result.data;
}

/** Fetch a single fact. `null` = genuine 404; infra failures throw. */
export async function fetchFact(
  userClient: UserClient,
  factId: string,
  userId?: string
): Promise<FactItem | null> {
  const result = await userClient.getFact(factId);
  warnNonMiss(result, { userId, factId }, 'Failed to fetch fact');
  return nullOn404(result)?.fact ?? null;
}

/**
 * Correct a fact — the gateway supersedes it with a corrected-tier fact and
 * returns the SURVIVOR (which can be a different row when the corrected
 * statement collides with an existing fact: the duplicates converge).
 * `null` = genuine 404; infra failures and the locked-fact 403 throw.
 */
export async function correctFact(
  userClient: UserClient,
  factId: string,
  statement: string,
  userId?: string
): Promise<FactItem | null> {
  const result = await userClient.correctFact(factId, { statement });
  warnNonMiss(result, { userId, factId }, 'Failed to correct fact');
  return nullOn404(result)?.fact ?? null;
}

/**
 * Forget a fact (terminal; never re-extracted). `false` = genuine 404
 * (already gone); infra failures and the locked-fact 403 throw.
 */
export async function forgetFact(
  userClient: UserClient,
  factId: string,
  userId?: string
): Promise<boolean> {
  const result = await userClient.forgetFact(factId);
  warnNonMiss(result, { userId, factId }, 'Failed to forget fact');
  return nullOn404(result) === null ? false : true;
}

/**
 * Set the fact lock explicitly (idempotent — caller supplies the target state
 * so a retried request can't flip the wrong way). `null` = genuine 404;
 * infra failures throw.
 */
export async function setFactLock(
  userClient: UserClient,
  factId: string,
  locked: boolean,
  userId?: string
): Promise<FactItem | null> {
  const result = await userClient.setFactLock(factId, { locked });
  warnNonMiss(result, { userId, factId, locked }, 'Failed to set fact lock');
  return nullOn404(result)?.fact ?? null;
}
