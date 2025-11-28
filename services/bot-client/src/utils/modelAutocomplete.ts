/**
 * Model Autocomplete Utilities
 *
 * Fetches available models from the API gateway's cached OpenRouter model list.
 * Used by autocomplete handlers for model selection in /llm-config and /model commands.
 */

import { getConfig, createLogger, type ModelAutocompleteOption } from '@tzurot/common-types';

const logger = createLogger('model-autocomplete-client');

/**
 * Response from /models endpoint
 */
interface ModelsResponse {
  models: ModelAutocompleteOption[];
  count: number;
}

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
}

/**
 * Get the gateway URL
 */
function getGatewayUrl(): string | null {
  const config = getConfig();
  const gatewayUrl = config.GATEWAY_URL;

  if (gatewayUrl === undefined || gatewayUrl === null || gatewayUrl.length === 0) {
    return null;
  }

  return gatewayUrl;
}

/**
 * Fetch available models from the API gateway
 *
 * Uses the cached OpenRouter model list in api-gateway.
 * This endpoint is public (no auth required).
 *
 * @param options - Filter options
 * @returns Array of model autocomplete options, or empty array on error
 */
export async function fetchModels(
  options: FetchModelsOptions = {}
): Promise<ModelAutocompleteOption[]> {
  const gatewayUrl = getGatewayUrl();

  if (gatewayUrl === null) {
    logger.warn({ gatewayUrl: 'not configured' }, '[ModelAutocomplete] Gateway URL not configured');
    return [];
  }

  try {
    // Build the endpoint path based on options
    let endpoint = '/models';

    if (options.textOnly === true) {
      endpoint = '/models/text';
    } else if (options.visionOnly === true) {
      endpoint = '/models/vision';
    } else if (options.imageGenOnly === true) {
      endpoint = '/models/image-generation';
    }

    // Build query string
    const params = new URLSearchParams();
    const searchQuery = options.search;
    if (searchQuery !== undefined && searchQuery.length > 0) {
      params.set('search', searchQuery);
    }
    if (options.limit !== undefined && options.limit > 0) {
      params.set('limit', String(options.limit));
    }

    const queryString = params.toString();
    const url =
      queryString.length > 0
        ? `${gatewayUrl}${endpoint}?${queryString}`
        : `${gatewayUrl}${endpoint}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn(
        { status: response.status, endpoint },
        '[ModelAutocomplete] Failed to fetch models'
      );
      return [];
    }

    const data = (await response.json()) as ModelsResponse;

    logger.debug(
      {
        count: data.count,
        textOnly: options.textOnly,
        visionOnly: options.visionOnly,
        search: options.search,
      },
      '[ModelAutocomplete] Fetched models'
    );

    return data.models;
  } catch (error) {
    logger.error({ err: error }, '[ModelAutocomplete] Error fetching models');
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
 * Format model for Discord autocomplete choice
 *
 * Discord limits:
 * - name: max 100 characters
 * - value: max 100 characters
 *
 * Format: "Provider: Model Name (128K context)"
 */
export function formatModelChoice(model: ModelAutocompleteOption): { name: string; value: string } {
  // Format context length nicely
  const contextStr = formatContextLength(model.contextLength);

  // Build the display name
  let displayName = model.name;
  if (contextStr.length > 0) {
    displayName = `${model.name} (${contextStr})`;
  }

  // Truncate if too long (Discord limit is 100 chars)
  if (displayName.length > 100) {
    displayName = displayName.substring(0, 97) + '...';
  }

  return {
    name: displayName,
    value: model.id, // The model slug (e.g., "anthropic/claude-sonnet-4")
  };
}

/**
 * Format context length for display
 */
function formatContextLength(tokens: number): string {
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
