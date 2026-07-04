/**
 * Model Autocomplete Utilities
 *
 * Fetches available models from the API gateway's cached OpenRouter model list.
 * Used by autocomplete handlers for model selection in /llm-config and /model commands.
 */

import { type ModelAutocompleteOption } from '@tzurot/common-types/types/ai';
import {
  AUTOCOMPLETE_BADGES,
  formatAutocompleteOption,
} from '@tzurot/common-types/utils/autocompleteFormat';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getServiceClient } from './gatewayClients.js';
import { nullOn404 } from '@tzurot/clients';

const logger = createLogger('model-autocomplete-client');

/**
 * Options for fetching models
 */
interface FetchModelsOptions {
  /** Filter for text generation models */
  textOnly?: boolean;
  /** Filter for vision-capable models */
  visionOnly?: boolean;
  /** Filter for image generation models */
  imageGenOnly?: boolean;
  /** Search query to filter by name or ID */
  search?: string;
  /** Maximum number of results */
  limit?: number;
  /**
   * When true, a non-404 failure THROWS (`InfraError` for infra / `GatewayClientError`
   * for a 4xx) instead of returning `[]` — so a transient gateway failure surfaces
   * as "try again", not as an empty catalog that reads to the user as "model not
   * found". Used by the catalog lookup that feeds `/models view` + browse-select.
   * Omit (lenient `[]`-on-error) for autocomplete, where an empty dropdown is fine.
   */
  strict?: boolean;
}

/**
 * Fetch available models from the API gateway's cached OpenRouter list.
 *
 * Goes through the typed `ServiceClient` (not a raw fetch) so the
 * `X-Service-Auth` header is attached automatically — the `/api/internal/models`
 * endpoint is public re: user auth but service-auth-gated like every
 * bot-client → gateway call. The capability flags map to the single
 * input/output-modality query pair the endpoint exposes.
 *
 * @param options - Filter options
 * @returns Array of model autocomplete options, or empty array on error
 */
export async function fetchModels(
  options: FetchModelsOptions = {}
): Promise<ModelAutocompleteOption[]> {
  const query: {
    inputModality?: string;
    outputModality?: string;
    search?: string;
    limit?: string;
  } = {};

  if (options.textOnly === true) {
    query.outputModality = 'text';
  } else if (options.visionOnly === true) {
    query.inputModality = 'image';
  } else if (options.imageGenOnly === true) {
    query.outputModality = 'image';
  }
  if (options.search !== undefined && options.search.length > 0) {
    query.search = options.search;
  }
  if (options.limit !== undefined && options.limit > 0) {
    // String for the URL query param; the route manifest coerces it back to a
    // number (z.coerce.number).
    query.limit = String(options.limit);
  }

  if (options.strict === true) {
    // Strict path (catalog → /models view + browse-select): a transient/infra
    // failure must surface as "try again", NOT as an empty catalog that reads
    // to the user as "model not found". nullOn404 throws InfraError (5xx /
    // timeout / network) or GatewayClientError (non-404 4xx); getModels has no
    // meaningful 404, so a 404 maps to empty.
    const data = nullOn404(await getServiceClient().getModels(query));
    return data?.models ?? [];
  }

  // Lenient path (autocomplete): never throw — an empty dropdown beats an
  // error popup for a transient blip.
  try {
    const result = await getServiceClient().getModels(query);
    if (!result.ok) {
      logger.warn({ error: result.error }, 'Failed to fetch models');
      return [];
    }
    return result.data.models;
  } catch (error) {
    logger.error({ err: error }, 'Error fetching models');
    return [];
  }
}

/**
 * Fetch text generation models for autocomplete
 */
export async function fetchTextModels(
  search?: string,
  limit = 25
): Promise<ModelAutocompleteOption[]> {
  return fetchModels({ textOnly: true, search, limit });
}

/**
 * Fetch vision-capable models for autocomplete
 */
export async function fetchVisionModels(
  search?: string,
  limit = 25
): Promise<ModelAutocompleteOption[]> {
  return fetchModels({ visionOnly: true, search, limit });
}

/**
 * Check if a model is free (no cost for prompt or completion)
 */
function isModelFree(model: ModelAutocompleteOption): boolean {
  return model.promptPricePerMillion === 0 && model.completionPricePerMillion === 0;
}

/**
 * Format model for Discord autocomplete choice
 *
 * Uses standardized formatAutocompleteOption for consistency across bot.
 * Format: "[🆓] Model Name · context"
 *
 * @example
 * // Free model
 * { name: "🆓 Llama 3.3 70B · 128K", value: "meta-llama/llama-3.3-70b-instruct:free" }
 *
 * // Paid model
 * { name: "Claude Sonnet 4 · 200K", value: "anthropic/claude-sonnet-4" }
 */
export function formatModelChoice(model: ModelAutocompleteOption): { name: string; value: string } {
  const contextStr = formatContextLength(model.contextLength);

  return formatAutocompleteOption({
    name: model.name,
    value: model.id,
    statusBadges: isModelFree(model) ? [AUTOCOMPLETE_BADGES.FREE] : undefined,
    metadata: contextStr.length > 0 ? contextStr : undefined,
  });
}

/**
 * Format context length for display
 */
export function formatContextLength(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return millions % 1 === 0 ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    const thousands = tokens / 1000;
    return thousands % 1 === 0 ? `${thousands}K` : `${thousands.toFixed(0)}K`;
  }
  return String(tokens);
}
