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
  handleNotFound,
  NotFoundError,
  isNotFoundError,
  type GatewayResult,
  type FetcherOptions,
  type UpdaterOptions,
  type DeleterOptions,
  type ListFetcherOptions,
  type DeleteResult,
} from './gatewayFetcher.js';
