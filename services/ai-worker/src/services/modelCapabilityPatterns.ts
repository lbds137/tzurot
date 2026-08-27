/**
 * Model Capability Patterns
 *
 * Substring heuristics for detecting vision and reasoning support from a model
 * ID alone. These are the LAST resort in ModelCapabilityChecker's resolution
 * order — they fire only when the OpenRouter catalog is unavailable, and they
 * carry no context-length knowledge.
 *
 * Kept in their own module because they are a self-contained, dependency-free
 * unit: a string in, a boolean out, with no cache or Redis coupling.
 */

interface ModelPattern {
  required: string;
  additional?: string[];
}

/**
 * Vision model patterns for fallback detection.
 * Each pattern has a required term and optional additional terms (any must match).
 *
 * Source of truth: OpenRouter /api/v1/models `architecture.input_modalities` field.
 * These fallbacks only fire when Redis cache (primary path) is unavailable.
 */
const VISION_MODEL_PATTERNS: ModelPattern[] = [
  // OpenAI vision models (gpt-4 + vision/4o/turbo)
  { required: 'gpt-4', additional: ['vision', '4o', 'turbo'] },
  // Anthropic Claude 3+ models
  { required: 'claude-3' },
  { required: 'claude-4' },
  // Google Gemini models — '2.' matches dot-separated (gemini-2.0-flash),
  // '2-' matches hyphen-separated (gemini-2-flash) alternate naming
  { required: 'gemini', additional: ['1.5', '2.', '2-', 'vision'] },
  // Google Gemma 3 / 4 models (both multimodal)
  { required: 'gemma-3' },
  { required: 'gemma3' },
  { required: 'gemma-4' },
  { required: 'gemma4' },
  // Llama vision models
  { required: 'llama', additional: ['vision'] },
  // Qwen VL models + Qwen 3.5 (natively multimodal; qwen3 base models are text-only)
  // Note: qwen3-vl is already matched by { required: 'qwen', additional: ['vl'] }
  { required: 'qwen', additional: ['vl', 'vision'] },
  { required: 'qwen3.5' },
  // Mistral vision models
  { required: 'pixtral' },
  // InternVL models
  { required: 'internvl' },
  // Z.AI GLM — mirrors the `supportsVision` flag on the z.ai coding-plan catalog
  // entry, so degraded mode agrees with the catalog. The full `glm-5.3-flash`
  // term is required: the GLM flash line is not uniformly multimodal, and a
  // broader 'glm-5.3' or 'flash' term would over-claim its text-only siblings.
  { required: 'glm-5.3-flash' },
];

/**
 * Reasoning model patterns for fallback detection.
 * Used when Redis cache is unavailable.
 *
 * Based on OpenRouter /api/v1/models `supported_parameters` data (March 2026).
 * These are conservative fallbacks — a false positive sends reasoning params
 * to a model that rejects them at the API level (recoverable), not data corruption.
 */
const REASONING_MODEL_PATTERNS: ModelPattern[] = [
  // DeepSeek R1 + V3 series (reasoning-capable per OpenRouter)
  { required: 'deepseek-r1' },
  { required: 'deepseek-reasoner' },
  { required: 'deepseek-v3' },
  { required: 'deepseek-chat-v3' },
  // Qwen QwQ (dedicated reasoning) + Qwen 3+ (all support reasoning per OpenRouter)
  // Note: 'qwen3' intentionally broad — matches qwen3, qwen3.5, qwen3-coder, etc.
  { required: 'qwq' },
  { required: 'qwen3' },
  // OpenAI GPT-5 family + GPT-OSS
  { required: 'gpt-5' },
  { required: 'gpt-oss' },
  // Anthropic Claude 3.7+ (model IDs: claude-3.7-sonnet, claude-sonnet-4.x, etc.)
  { required: 'claude-3.7' },
  { required: 'claude-sonnet-4' },
  { required: 'claude-opus-4' },
  { required: 'claude-haiku-4' },
  // Google Gemini 1.5+ — '2.' matches dot-separated, '2-' matches hyphen-separated
  { required: 'gemini', additional: ['1.5', '2.', '2-', '3'] },
  // Kimi K2 (confirmed reasoning-capable)
  { required: 'kimi-k2' },
  // GLM 4+/5 (Z.AI, confirmed reasoning-capable)
  { required: 'glm-4' },
  { required: 'glm-5' },
  // xAI Grok 3+ (reasoning-capable per OpenRouter)
  { required: 'grok-3' },
  { required: 'grok-4' },
];

/** Check patterns against a normalized model name */
function matchesPatterns(normalized: string, patterns: ModelPattern[]): boolean {
  return patterns.some(pattern => {
    if (!normalized.includes(pattern.required)) {
      return false;
    }
    if (!pattern.additional) {
      return true;
    }
    return pattern.additional.some(term => normalized.includes(term));
  });
}

/**
 * Fallback pattern matching for vision support detection
 * Used when Redis cache is unavailable
 */
export function hasVisionSupportFallback(modelName: string): boolean {
  return matchesPatterns(modelName.toLowerCase(), VISION_MODEL_PATTERNS);
}

/**
 * Fallback pattern matching for reasoning support detection
 * Used when Redis cache is unavailable
 */
export function hasReasoningSupportFallback(modelName: string): boolean {
  return matchesPatterns(modelName.toLowerCase(), REASONING_MODEL_PATTERNS);
}
