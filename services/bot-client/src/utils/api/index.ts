/**
 * API Utilities
 *
 * Shared utilities for making API calls to the gateway.
 */

export {
  createEntityFetcher,
  createEntityUpdater,
  createEntityDeleter,
  createListFetcher,
  unwrapOrThrow,
  NotFoundError,
  isNotFoundError,
  type GatewayResult,
  type FetcherOptions,
  type UpdaterOptions,
  type DeleterOptions,
  type ListFetcherOptions,
  type DeleteResult,
} from './gatewayFetcher.js';
