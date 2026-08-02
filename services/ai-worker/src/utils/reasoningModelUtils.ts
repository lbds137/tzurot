/**
 * Reasoning Model Detection
 *
 * Identifies models with reasoning/thinking capabilities by name. Consumers:
 * reasoning-effort plumbing (ModelFactory) and invocation logging (LLMInvoker).
 *
 * Detection is the whole job. Thinking-tag stripping lives in
 * ResponsePostProcessor's extraction chain, which handles the per-family tag
 * vocabularies; reasoning-model request-shape rewrites no longer exist (the
 * o-series system-message transform was deleted when OpenAI deprecated the
 * o-series — no current model rejects the `system` role).
 */

/**
 * Patterns to identify reasoning/thinking models
 *
 * These models may emit thinking tags that need to be stripped from output.
 */
const REASONING_MODEL_PATTERNS = {
  // Claude models with extended thinking capability
  // Claude 3.7+ supports extended thinking (e.g., claude-3-7-sonnet-20250219)
  CLAUDE_EXTENDED_THINKING: /claude-3-[789]|claude-4/i,

  // Gemini 2.0+ Thinking models
  GEMINI_THINKING: /gemini-2\.[0-9].*-thinking|gemini-3.*think/i,

  // DeepSeek R1 reasoning models - emit <think> tags
  // Includes R1T variants like tng-r1t-chimera (R1+V3 merge)
  DEEPSEEK_R1: /deepseek.*r1|deepseek.*reasoner|r1t.*chimera/i,

  // Qwen QwQ reasoning models - emit <think> tags
  QWEN_REASONING: /qwen.*qwq|qwq/i,

  // GLM-4.x with thinking mode - emit <think> tags
  GLM_THINKING: /glm-4\.[5-9]|glm-4\.[1-9][0-9]/i,

  // Kimi K2/K2.5 thinking models - emit <think> tags
  KIMI_THINKING: /kimi.*k2.*thinking|kimi-k2/i,

  // OpenAI GPT-OSS-120B - mandatory reasoning with effort levels
  GPT_OSS: /gpt-oss/i,

  // StepFun Step 3.5 - mandatory reasoning, always thinks
  STEPFUN: /step-3\.5/i,

  // NousResearch Hermes 4 - hybrid reasoning with optional <think> tags
  HERMES_4: /hermes-4/i,

  // Xiaomi MiMo - optional <think> when reasoning enabled
  MIMO: /mimo-v2/i,

  // Generic thinking model pattern (any model with "thinking" in name)
  GENERIC_THINKING: /thinking/i,
} as const;

/**
 * Types of reasoning model constraints
 */
export enum ReasoningModelType {
  /** Standard model - no special handling needed */
  Standard = 'standard',
  /** Claude with extended thinking */
  ClaudeExtendedThinking = 'claude-extended-thinking',
  /** Gemini thinking model */
  GeminiThinking = 'gemini-thinking',
  /** DeepSeek R1 reasoning models - emit <think> tags */
  DeepSeekR1 = 'deepseek-r1',
  /** Qwen QwQ reasoning models - emit <think> tags */
  QwenReasoning = 'qwen-reasoning',
  /** GLM-4.x thinking models - emit <think> tags */
  GlmThinking = 'glm-thinking',
  /** Kimi K2 thinking models - emit <think> tags */
  KimiThinking = 'kimi-thinking',
  /** OpenAI GPT-OSS-120B - mandatory reasoning */
  GptOss = 'gpt-oss',
  /** StepFun Step 3.5 - mandatory reasoning */
  StepFun = 'stepfun',
  /** NousResearch Hermes 4 - hybrid reasoning */
  Hermes4 = 'hermes-4',
  /** Xiaomi MiMo - optional reasoning */
  MiMo = 'mimo',
  /** Generic thinking model (matched by name pattern) */
  GenericThinking = 'generic-thinking',
}

/**
 * Pattern-to-type mapping for data-driven detection.
 * Order matters: more specific patterns should be checked first.
 * Generic thinking is last to avoid false positives.
 */
const DETECTION_ORDER: readonly { pattern: RegExp; type: ReasoningModelType }[] = [
  {
    pattern: REASONING_MODEL_PATTERNS.CLAUDE_EXTENDED_THINKING,
    type: ReasoningModelType.ClaudeExtendedThinking,
  },
  { pattern: REASONING_MODEL_PATTERNS.GEMINI_THINKING, type: ReasoningModelType.GeminiThinking },
  { pattern: REASONING_MODEL_PATTERNS.DEEPSEEK_R1, type: ReasoningModelType.DeepSeekR1 },
  { pattern: REASONING_MODEL_PATTERNS.QWEN_REASONING, type: ReasoningModelType.QwenReasoning },
  { pattern: REASONING_MODEL_PATTERNS.GLM_THINKING, type: ReasoningModelType.GlmThinking },
  { pattern: REASONING_MODEL_PATTERNS.KIMI_THINKING, type: ReasoningModelType.KimiThinking },
  { pattern: REASONING_MODEL_PATTERNS.GPT_OSS, type: ReasoningModelType.GptOss },
  { pattern: REASONING_MODEL_PATTERNS.STEPFUN, type: ReasoningModelType.StepFun },
  { pattern: REASONING_MODEL_PATTERNS.HERMES_4, type: ReasoningModelType.Hermes4 },
  { pattern: REASONING_MODEL_PATTERNS.MIMO, type: ReasoningModelType.MiMo },
  // Generic thinking is last to avoid false positives on models with "thinking" in name
  { pattern: REASONING_MODEL_PATTERNS.GENERIC_THINKING, type: ReasoningModelType.GenericThinking },
] as const;

/**
 * Detect the type of reasoning model from its name
 *
 * @param modelName - The model identifier (e.g., "deepseek/deepseek-r1")
 * @returns The type of reasoning model
 */
export function detectReasoningModelType(modelName: string): ReasoningModelType {
  for (const { pattern, type } of DETECTION_ORDER) {
    if (pattern.test(modelName)) {
      return type;
    }
  }
  return ReasoningModelType.Standard;
}

/**
 * Check if a model is a reasoning/thinking model
 *
 * @param modelName - The model identifier
 * @returns true if the model has reasoning capabilities
 */
export function isReasoningModel(modelName: string): boolean {
  return detectReasoningModelType(modelName) !== ReasoningModelType.Standard;
}
