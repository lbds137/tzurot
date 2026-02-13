/**
 * Preset Configuration Validation
 *
 * LLM-specific validation rules for preset configurations.
 * Uses the shared ConfigValidator framework from utils/configValidation.
 *
 * Validation categories:
 * - ERRORS: Invalid configurations that cannot be saved
 * - WARNINGS: Questionable but valid configurations
 */

import { ConfigValidator } from '../../utils/configValidation.js';
import type { FlattenedPresetData } from './config.js';

/**
 * Parse numeric string value, returning undefined if empty or invalid
 */
function parseNum(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  const num = parseFloat(value);
  return isNaN(num) ? undefined : num;
}

/**
 * Validator for LLM preset configurations.
 *
 * Error rules (block save):
 * - min_p + top_a conflict: Both achieve similar goals, use one
 * - reasoning.max_tokens >= max_tokens: Must leave room for response
 *
 * Warning rules (allow save, display caution):
 * - Low temperature + low top_p: May produce repetitive output
 * - High temperature: May produce incoherent output
 * - Multiple penalty strategies: Usually one approach is sufficient
 * - High repetition_penalty: May break grammar
 */
export const presetConfigValidator = new ConfigValidator<FlattenedPresetData>()
  // =========================================
  // ERRORS (block save)
  // =========================================

  .addError(
    'min_p / top_a',
    c => {
      const minP = parseNum(c.min_p);
      const topA = parseNum(c.top_a);
      return minP !== undefined && minP > 0 && topA !== undefined && topA > 0;
    },
    'Use min_p OR top_a, not both. They achieve the same goal (dynamic probability filtering) differently.'
  )

  .addError(
    'reasoning_max_tokens',
    c => {
      const reasoningTokens = parseNum(c.reasoning_max_tokens);
      const maxTokens = parseNum(c.max_tokens);
      return (
        reasoningTokens !== undefined && maxTokens !== undefined && reasoningTokens >= maxTokens
      );
    },
    'Reasoning tokens must be less than max_tokens to leave room for the actual response.'
  )

  // =========================================
  // WARNINGS (allow save with caution)
  // =========================================

  .addWarning(
    'temperature / top_p',
    c => {
      const temp = parseNum(c.temperature);
      const topP = parseNum(c.top_p);
      return temp !== undefined && temp < 0.5 && topP !== undefined && topP < 0.8;
    },
    'Low temperature + low top_p makes output very predictable and repetitive. Consider increasing one.'
  )

  .addWarning(
    'temperature',
    c => {
      const temp = parseNum(c.temperature);
      return temp !== undefined && temp > 1.5;
    },
    'Temperature >1.5 often produces incoherent or nonsensical output. Use with caution.'
  )

  .addWarning(
    'penalties',
    c => {
      const repPenalty = parseNum(c.repetition_penalty);
      const freqPenalty = parseNum(c.frequency_penalty);
      const presPenalty = parseNum(c.presence_penalty);
      // Check if using repetition_penalty AND (frequency or presence penalty)
      return (
        repPenalty !== undefined &&
        repPenalty !== 1 &&
        ((freqPenalty !== undefined && freqPenalty !== 0) ||
          (presPenalty !== undefined && presPenalty !== 0))
      );
    },
    'Using repetition_penalty with frequency/presence penalties is redundant. Pick one penalty strategy.'
  )

  .addWarning(
    'repetition_penalty',
    c => {
      const repPenalty = parseNum(c.repetition_penalty);
      return repPenalty !== undefined && repPenalty > 1.5;
    },
    'Repetition penalty >1.5 may break grammar by penalizing common words like "the" and "a".'
  )

  .addWarning(
    'max_tokens',
    c => {
      const maxTokens = parseNum(c.max_tokens);
      return maxTokens !== undefined && maxTokens < 100;
    },
    'Max tokens <100 severely limits response length. Most responses need at least 500 tokens.'
  )

  .addWarning(
    'reasoning_effort',
    c => {
      const effort = c.reasoning_effort;
      const reasoningEnabled = c.reasoning_enabled;
      // Warn if effort is set but reasoning is explicitly disabled
      return effort !== undefined && effort.length > 0 && reasoningEnabled === 'false';
    },
    'Reasoning effort is set but reasoning is disabled. Enable reasoning or remove effort setting.'
  )

  .addWarning(
    'reasoning_effort / max_tokens',
    c => {
      const effort = c.reasoning_effort;
      const maxTokens = parseNum(c.max_tokens);
      return effort !== undefined && effort.length > 0 && maxTokens !== undefined;
    },
    'Reasoning effort and max_tokens are mutually exclusive for reasoning models. When effort is set, max_tokens is ignored.'
  );

/**
 * User-friendly descriptions for LLM parameters.
 * Used in help text and tooltips.
 */
export const PARAMETER_DESCRIPTIONS: Record<string, string> = {
  temperature:
    'Controls randomness (0=deterministic, 2=very random). Default: 0.7-1.0 for balanced creativity.',
  top_p:
    'Nucleus sampling - limits to top % of probability mass. Lower = more focused. Default: 0.9-1.0',
  top_k: 'Limits to top K word choices (0=disabled). Advanced sampling control. Default: 40-50',
  min_p:
    'Filters words below this probability relative to the top word. Alternative to top_k/top_p.',
  top_a:
    'Dynamic probability filtering based on the shape of the distribution. Alternative to min_p.',
  frequency_penalty:
    'Reduces word repetition based on how often words appear (-2 to 2). Default: 0',
  presence_penalty: 'Discourages any repeated words (-2 to 2). Good for variety. Default: 0',
  repetition_penalty:
    'Alternative repetition control (1.0=none, 2.0=strong). Pick this OR freq/presence penalties.',
  max_tokens: 'Maximum response length in tokens (~4 chars each). Default: 2048-4096',
  seed: 'Fixed seed for reproducible outputs. Same seed + same input = same output.',
  reasoning_effort:
    'Thinking intensity: xhigh (~95%), high (~80%), medium (~50%), low (~20%), minimal (~10%), none',
  reasoning_max_tokens: 'Direct token budget for thinking. Must be less than max_tokens.',
};
