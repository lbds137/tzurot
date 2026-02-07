/**
 * AI-related types
 */

export type MessageContent =
  | string
  | {
      content: string;
      referencedMessage?: {
        author?: string;
        content: string;
      };
      attachments?: {
        name?: string;
        url?: string;
        type?: string;
      }[];
    };

/**
 * OpenRouter model modality types
 */
export type ModelModality = 'text' | 'image' | 'audio' | 'video' | 'file';

/**
 * OpenRouter model architecture information
 */
export interface OpenRouterModelArchitecture {
  /** Combined modality string (e.g., "text->text", "text+image->text") */
  modality: string;
  /** Supported input modalities */
  input_modalities: ModelModality[];
  /** Supported output modalities */
  output_modalities: ModelModality[];
  /** Tokenizer type */
  tokenizer: string;
  /** Instruction type (if any) */
  instruct_type: string | null;
}

/**
 * OpenRouter model pricing information (per-token costs as strings)
 */
export interface OpenRouterModelPricing {
  /** Cost per prompt token */
  prompt: string;
  /** Cost per completion token */
  completion: string;
  /** Cost per request */
  request: string;
  /** Cost per image */
  image: string;
  /** Cost for web search */
  web_search: string;
  /** Cost for internal reasoning */
  internal_reasoning: string;
}

/**
 * OpenRouter model top provider information
 */
export interface OpenRouterModelTopProvider {
  /** Maximum context length for this provider */
  context_length: number;
  /** Maximum completion tokens */
  max_completion_tokens: number;
  /** Whether the model is moderated */
  is_moderated: boolean;
}

/**
 * OpenRouter model information from /api/v1/models endpoint
 */
export interface OpenRouterModel {
  /** Model ID/slug for API calls (e.g., "anthropic/claude-sonnet-4") */
  id: string;
  /** Canonical slug with version */
  canonical_slug: string;
  /** Hugging Face model ID (if applicable) */
  hugging_face_id: string | null;
  /** Human-readable model name */
  name: string;
  /** Unix timestamp when model was added */
  created: number;
  /** Model description */
  description: string;
  /** Maximum context length in tokens */
  context_length: number;
  /** Model architecture and modality information */
  architecture: OpenRouterModelArchitecture;
  /** Pricing information */
  pricing: OpenRouterModelPricing;
  /** Top provider configuration */
  top_provider: OpenRouterModelTopProvider;
  /** Per-request limits (null if none) */
  per_request_limits: Record<string, unknown> | null;
  /** Supported API parameters */
  supported_parameters: string[];
  /** Default parameter values */
  default_parameters: Record<string, unknown>;
}

/**
 * Response from OpenRouter /api/v1/models endpoint
 */
export interface OpenRouterModelsResponse {
  data: OpenRouterModel[];
}

/**
 * Simplified model info for autocomplete and display
 */
export interface ModelAutocompleteOption {
  /** Model ID/slug for API calls */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Context length in tokens */
  contextLength: number;
  /** Whether model supports vision (image input) */
  supportsVision: boolean;
  /** Whether model supports image generation (image output) */
  supportsImageGeneration: boolean;
  /** Whether model supports audio input */
  supportsAudioInput: boolean;
  /** Whether model supports audio output */
  supportsAudioOutput: boolean;
  /** Pricing per million prompt tokens (for display) */
  promptPricePerMillion: number;
  /** Pricing per million completion tokens (for display) */
  completionPricePerMillion: number;
}
