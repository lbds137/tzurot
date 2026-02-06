/**
 * Reasoning Model Utilities
 *
 * Handles special requirements for AI models with reasoning/thinking capabilities:
 * - OpenAI o1/o3 series: No system messages, use max_completion_tokens
 * - Claude 3.7+: Extended thinking requires temperature=1
 * - Gemini 2.0 Flash Thinking: Uses thinkingConfig.thinkingBudget
 *
 * All reasoning models may emit `<thinking>` tags that should be stripped from output.
 */

import { createLogger } from '@tzurot/common-types';
import { SystemMessage, HumanMessage, BaseMessage } from '@langchain/core/messages';

const logger = createLogger('ReasoningModelUtils');

/**
 * Patterns to identify reasoning/thinking models
 *
 * These models may emit thinking tags that need to be stripped from output.
 * Detection enables early stripping in LLMInvoker as a first line of defense.
 */
export const REASONING_MODEL_PATTERNS = {
  // OpenAI o1/o3 models - require no system messages
  OPENAI_O_SERIES: /^(openai\/)?o[13](-mini|-preview)?(-\d+)?$/i,

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
  /** OpenAI o1/o3 - no system messages allowed */
  OpenAIReasoning = 'openai-reasoning',
  /** Claude with extended thinking - temperature must be 1.0 */
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
 * Configuration adjustments needed for reasoning models
 */
export interface ReasoningModelConfig {
  /** Type of reasoning model */
  type: ReasoningModelType;
  /** Whether system messages are allowed */
  allowsSystemMessage: boolean;
  /** Required temperature (null = use default) */
  requiredTemperature: number | null;
  /** Whether to use max_completion_tokens instead of max_tokens */
  useMaxCompletionTokens: boolean;
  /** Whether output may contain <thinking> tags to strip */
  mayContainThinkingTags: boolean;
}

/**
 * Pattern-to-type mapping for data-driven detection.
 * Order matters: more specific patterns should be checked first.
 * Generic thinking is last to avoid false positives.
 */
const DETECTION_ORDER: readonly { pattern: RegExp; type: ReasoningModelType }[] = [
  { pattern: REASONING_MODEL_PATTERNS.OPENAI_O_SERIES, type: ReasoningModelType.OpenAIReasoning },
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
 * @param modelName - The model identifier (e.g., "openai/o1-preview", "deepseek/deepseek-r1")
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
 * Get configuration requirements for a reasoning model
 *
 * @param modelName - The model identifier
 * @returns Configuration requirements
 */
export function getReasoningModelConfig(modelName: string): ReasoningModelConfig {
  const type = detectReasoningModelType(modelName);

  switch (type) {
    case ReasoningModelType.OpenAIReasoning:
      return {
        type,
        allowsSystemMessage: false,
        requiredTemperature: null, // o1/o3 doesn't support temperature parameter
        useMaxCompletionTokens: true,
        mayContainThinkingTags: true,
      };

    case ReasoningModelType.ClaudeExtendedThinking:
      return {
        type,
        allowsSystemMessage: true,
        requiredTemperature: 1.0, // Extended thinking requires temperature=1
        useMaxCompletionTokens: false,
        mayContainThinkingTags: true,
      };

    case ReasoningModelType.GeminiThinking:
      return {
        type,
        allowsSystemMessage: true,
        requiredTemperature: null,
        useMaxCompletionTokens: false,
        mayContainThinkingTags: true,
      };

    // DeepSeek, Qwen, GLM, Kimi, GPT-OSS, StepFun, Hermes 4, MiMo
    // All emit <think> tags in text output
    case ReasoningModelType.DeepSeekR1:
    case ReasoningModelType.QwenReasoning:
    case ReasoningModelType.GlmThinking:
    case ReasoningModelType.KimiThinking:
    case ReasoningModelType.GptOss:
    case ReasoningModelType.StepFun:
    case ReasoningModelType.Hermes4:
    case ReasoningModelType.MiMo:
    case ReasoningModelType.GenericThinking:
      return {
        type,
        allowsSystemMessage: true,
        requiredTemperature: null,
        useMaxCompletionTokens: false,
        mayContainThinkingTags: true,
      };

    default:
      return {
        type: ReasoningModelType.Standard,
        allowsSystemMessage: true,
        requiredTemperature: null,
        useMaxCompletionTokens: false,
        mayContainThinkingTags: false,
      };
  }
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

/**
 * Transform messages for reasoning models that don't support system messages.
 * Converts SystemMessage to a HumanMessage with the system content prefixed.
 *
 * @param messages - Original messages array
 * @param modelConfig - Reasoning model configuration
 * @returns Transformed messages array
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- pre-existing: message transformation has inherent branching
export function transformMessagesForReasoningModel(
  messages: BaseMessage[],
  modelConfig: ReasoningModelConfig
): BaseMessage[] {
  if (modelConfig.allowsSystemMessage) {
    return messages;
  }

  // For models that don't support system messages (OpenAI o1/o3),
  // convert system message to user message with a prefix
  const transformedMessages: BaseMessage[] = [];
  let systemContent = '';

  for (const message of messages) {
    if (message instanceof SystemMessage || message._getType() === 'system') {
      // Collect system message content to prepend to first user message
      const content =
        typeof message.content === 'string'
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .map(c => (typeof c === 'object' && 'text' in c ? c.text : ''))
                .join('')
            : '';
      systemContent += content + '\n\n';
      logger.debug(
        { contentLength: content.length },
        '[ReasoningModelUtils] Converting system message to context prefix'
      );
    } else {
      transformedMessages.push(message);
    }
  }

  // If we collected system content, prepend it to the first user message
  if (systemContent && transformedMessages.length > 0) {
    const firstMessage = transformedMessages[0];
    if (firstMessage instanceof HumanMessage || firstMessage._getType() === 'human') {
      const originalContent =
        typeof firstMessage.content === 'string'
          ? firstMessage.content
          : Array.isArray(firstMessage.content)
            ? firstMessage.content
                .map(c => (typeof c === 'object' && 'text' in c ? c.text : ''))
                .join('')
            : '';

      // Create new message with system context prepended
      transformedMessages[0] = new HumanMessage({
        content: `[System Instructions]\n${systemContent}[End System Instructions]\n\n${originalContent}`,
      });

      logger.info(
        '[ReasoningModelUtils] Prepended system message content to first user message for o-series model'
      );
    }
  }

  return transformedMessages;
}

/**
 * Strip thinking tags from model output.
 * Removes content between <thinking> and </thinking> tags (including the tags).
 *
 * @param content - The model output content
 * @returns Content with thinking tags removed
 */
export function stripThinkingTags(content: string): string {
  // Match <thinking>...</thinking> including newlines (non-greedy)
  const thinkingPattern = /<thinking>[\s\S]*?<\/thinking>/gi;

  const stripped = content.replace(thinkingPattern, '').trim();

  // Also handle lowercase and variations
  const thinkPattern2 = /<think>[\s\S]*?<\/think>/gi;
  const finalResult = stripped.replace(thinkPattern2, '').trim();

  if (finalResult !== content) {
    const removedLength = content.length - finalResult.length;
    logger.debug(
      { originalLength: content.length, strippedLength: finalResult.length, removedLength },
      '[ReasoningModelUtils] Stripped thinking tags from response'
    );
  }

  return finalResult;
}

/**
 * Process model output to strip thinking tags if needed
 *
 * @param content - The raw model output
 * @param modelConfig - Reasoning model configuration
 * @returns Processed content
 */
export function processReasoningModelOutput(
  content: string,
  modelConfig: ReasoningModelConfig
): string {
  if (!modelConfig.mayContainThinkingTags) {
    return content;
  }

  return stripThinkingTags(content);
}
