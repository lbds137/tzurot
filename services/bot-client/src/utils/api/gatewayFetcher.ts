/**
 * Gateway Fetcher Utilities
 *
 * Factory functions for creating standardized API fetch functions.
 * Reduces boilerplate when creating command API modules.
 */

import { createLogger } from '@tzurot/common-types';
import { callGatewayApi, type GatewayUser } from '../userGatewayClient.js';

/**
 * Result type that matches callGatewayApi return
 */
type GatewayResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: string; status: number };

/**
 * Options for creating a fetch function
 */
interface FetcherOptions<TResponse, TResult> {
  /** Logger name for this fetcher */
  loggerName: string;
  /** Function to extract the result from the response */
  extractResult: (response: TResponse) => TResult;
  /** Action name for log messages (e.g., 'fetch persona') */
  actionName: string;
}

/**
 * Create a standardized GET fetcher for an entity.
 *
 * @returns A function that fetches a single entity by ID
 *
 * @example
 * ```typescript
 * const fetchPersona = createEntityFetcher<PersonaResponse, PersonaDetails>({
 *   loggerName: 'persona-api',
 *   extractResult: (response) => response.persona,
 *   actionName: 'fetch persona',
 * });
 *
 * const persona = await fetchPersona('/user/persona', personaId, user);
 * ```
 */
export function createEntityFetcher<TResponse, TResult>(
  options: FetcherOptions<TResponse, TResult>
): (endpoint: string, entityId: string, user: GatewayUser) => Promise<TResult | null> {
  const logger = createLogger(options.loggerName);

  return async (endpoint: string, entityId: string, user: GatewayUser): Promise<TResult | null> => {
    const result = await callGatewayApi<TResponse>(`${endpoint}/${encodeURIComponent(entityId)}`, {
      user,
    });

    if (!result.ok) {
      logger.warn(
        { userId: user.discordId, entityId, error: result.error },
        `Failed to ${options.actionName}`
      );
      return null;
    }

    return options.extractResult(result.data);
  };
}

/**
 * Options for creating an update function
 */
interface UpdaterOptions<TResponse, TResult> {
  /** Logger name for this updater */
  loggerName: string;
  /** Function to extract the result from the response */
  extractResult: (response: TResponse) => TResult;
  /** Action name for log messages (e.g., 'update persona') */
  actionName: string;
  /** Whether to throw on failure (default: false, returns null) */
  throwOnError?: boolean;
}

/**
 * Create a standardized PUT updater for an entity.
 *
 * @returns A function that updates an entity by ID
 *
 * @example
 * ```typescript
 * const updatePersona = createEntityUpdater<PersonaResponse, PersonaDetails>({
 *   loggerName: 'persona-api',
 *   extractResult: (response) => response.persona,
 *   actionName: 'update persona',
 * });
 *
 * const updated = await updatePersona('/user/persona', personaId, data, user);
 * ```
 */
export function createEntityUpdater<TResponse, TResult>(
  options: UpdaterOptions<TResponse, TResult>
): (
  endpoint: string,
  entityId: string,
  data: Record<string, unknown>,
  user: GatewayUser
) => Promise<TResult | null> {
  const logger = createLogger(options.loggerName);

  return async (
    endpoint: string,
    entityId: string,
    data: Record<string, unknown>,
    user: GatewayUser
  ): Promise<TResult | null> => {
    const result = await callGatewayApi<TResponse>(`${endpoint}/${encodeURIComponent(entityId)}`, {
      method: 'PUT',
      user,
      body: data,
    });

    if (!result.ok) {
      logger.warn(
        { userId: user.discordId, entityId, error: result.error },
        `Failed to ${options.actionName}`
      );
      if (options.throwOnError === true) {
        throw new Error(`Failed to ${options.actionName}: ${result.status} - ${result.error}`);
      }
      return null;
    }

    return options.extractResult(result.data);
  };
}

/**
 * Delete result with error information
 */
interface DeleteResult {
  success: boolean;
  error?: string;
}

/**
 * Options for creating a delete function
 */
interface DeleterOptions {
  /** Logger name for this deleter */
  loggerName: string;
  /** Action name for log messages (e.g., 'delete persona') */
  actionName: string;
}

/**
 * Create a standardized DELETE function for an entity.
 *
 * @returns A function that deletes an entity by ID
 *
 * @example
 * ```typescript
 * const deletePersona = createEntityDeleter({
 *   loggerName: 'persona-api',
 *   actionName: 'delete persona',
 * });
 *
 * const result = await deletePersona('/user/persona', personaId, user);
 * if (!result.success) {
 *   console.log('Failed:', result.error);
 * }
 * ```
 */
export function createEntityDeleter(
  options: DeleterOptions
): (endpoint: string, entityId: string, user: GatewayUser) => Promise<DeleteResult> {
  const logger = createLogger(options.loggerName);

  return async (endpoint: string, entityId: string, user: GatewayUser): Promise<DeleteResult> => {
    const result = await callGatewayApi<{ message: string }>(
      `${endpoint}/${encodeURIComponent(entityId)}`,
      {
        method: 'DELETE',
        user,
      }
    );

    if (!result.ok) {
      logger.warn(
        { userId: user.discordId, entityId, error: result.error },
        `Failed to ${options.actionName}`
      );
      return { success: false, error: result.error };
    }

    return { success: true };
  };
}

/**
 * Options for creating a list fetcher
 */
interface ListFetcherOptions<TResponse, TResult> {
  /** Logger name for this fetcher */
  loggerName: string;
  /** Function to extract the list from the response */
  extractList: (response: TResponse) => TResult[];
  /** Action name for log messages (e.g., 'list personas') */
  actionName: string;
}

/**
 * Create a standardized list fetcher for entities.
 *
 * @returns A function that fetches a list of entities
 *
 * @example
 * ```typescript
 * const listPersonas = createListFetcher<ListPersonasResponse, PersonaSummary>({
 *   loggerName: 'persona-api',
 *   extractList: (response) => response.personas,
 *   actionName: 'list personas',
 * });
 *
 * const personas = await listPersonas('/user/persona', user);
 * ```
 */
export function createListFetcher<TResponse, TResult>(
  options: ListFetcherOptions<TResponse, TResult>
): (endpoint: string, user: GatewayUser) => Promise<TResult[] | null> {
  const logger = createLogger(options.loggerName);

  return async (endpoint: string, user: GatewayUser): Promise<TResult[] | null> => {
    const result = await callGatewayApi<TResponse>(endpoint, { user });

    if (!result.ok) {
      logger.warn(
        { userId: user.discordId, error: result.error },
        `Failed to ${options.actionName}`
      );
      return null;
    }

    return options.extractList(result.data);
  };
}

/**
 * Unwrap a gateway result or throw an appropriate error.
 *
 * - Returns data if result is ok
 * - Throws NotFoundError for 404 responses
 * - Throws generic Error for other failures
 *
 * @example
 * ```typescript
 * const result = await callGatewayApi<Response>('/user/preset/123', { user });
 * const data = unwrapOrThrow(result, 'preset');
 * // Returns data on success, throws NotFoundError for 404, throws Error otherwise
 * ```
 */
export function unwrapOrThrow<T>(result: GatewayResult<T>, entityType: string): T {
  if (result.ok) {
    return result.data;
  }

  if (result.status === 404) {
    throw new NotFoundError(entityType);
  }

  throw new Error(`Failed to fetch ${entityType}: ${result.status} - ${result.error}`);
}

/**
 * Custom error for 404 responses
 */
export class NotFoundError extends Error {
  readonly entityType: string;
  readonly status = 404;

  constructor(entityType: string) {
    super(`${entityType} not found`);
    this.name = 'NotFoundError';
    this.entityType = entityType;
  }
}

/**
 * Check if an error is a NotFoundError
 */
export function isNotFoundError(error: unknown): error is NotFoundError {
  return error instanceof NotFoundError;
}
