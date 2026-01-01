/**
 * PersonalityValidator
 * Zod schemas and validation logic for personality LLM configuration
 */

import { z } from 'zod';
import { Prisma } from '../prisma.js';
import { createLogger } from '../../utils/logger.js';

// Re-export Decimal type for convenience
type Decimal = Prisma.Decimal;

const logger = createLogger('PersonalityValidator');

/**
 * Helper to safely convert Prisma.Decimal or number to a number for Zod's validation
 */
function coerceToNumber(val: unknown): number | undefined {
  // Handle Prisma Decimal type
  if (
    val !== null &&
    typeof val === 'object' &&
    'toNumber' in val &&
    typeof val.toNumber === 'function'
  ) {
    return (val as Decimal).toNumber();
  }
  if (typeof val === 'number') {
    return val;
  }
  // Return undefined for null/undefined to let .optional() work correctly
  if (val === null || val === undefined) {
    return undefined;
  }
  // Unexpected type - log and return undefined to trigger Zod validation error
  logger.warn({ val, type: typeof val }, 'Unexpected value type in coerceToNumber');
  return undefined;
}

/**
 * Zod schema for LLM configuration with automatic Prisma Decimal conversion
 *
 * Safety notes:
 * - All numeric fields use coerceToNumber to handle Prisma Decimal and null values
 * - Range validation prevents invalid values from reaching the AI providers
 * - .nullish() at top level handles both null and undefined for the entire config
 *
 * Safety limit rationale:
 * - maxTokens (1M): Most models support 32k-200k context windows; 1M prevents excessive API costs
 * - topK (1-1000): Common LLM parameter range; prevents extreme values that degrade quality
 * - memoryLimit (1000): Prevents excessive DB queries and API latency from too many memories
 * - contextWindowTokens (2M): Future-proof for upcoming long-context models (Gemini 1.5 Pro supports 2M)
 */
export const LlmConfigSchema = z
  .object({
    model: z.string().nullable().optional(), // Nullable for extra safety despite DB constraint
    visionModel: z.string().nullable().optional(),
    temperature: z.preprocess(coerceToNumber, z.number().min(0).max(2).optional()),
    maxTokens: z.preprocess(coerceToNumber, z.number().int().positive().max(1000000).optional()),
    topP: z.preprocess(coerceToNumber, z.number().min(0).max(1).optional()),
    topK: z.preprocess(coerceToNumber, z.number().int().min(1).max(1000).optional()),
    frequencyPenalty: z.preprocess(coerceToNumber, z.number().min(-2).max(2).optional()),
    presencePenalty: z.preprocess(coerceToNumber, z.number().min(-2).max(2).optional()),
    repetitionPenalty: z.preprocess(coerceToNumber, z.number().min(0).max(2).optional()),
    memoryScoreThreshold: z.preprocess(coerceToNumber, z.number().min(0).max(1).optional()),
    memoryLimit: z.preprocess(coerceToNumber, z.number().int().positive().max(1000).optional()),
    contextWindowTokens: z.preprocess(
      coerceToNumber,
      z.number().int().positive().max(2000000).optional()
    ),
  })
  .nullish();

/**
 * Inferred TypeScript type from the Zod schema
 */
export type LlmConfig = z.infer<typeof LlmConfigSchema>;

/**
 * Safely parses an unknown database object into a clean LlmConfig object
 * @param dbConfig - Unknown config object from database
 * @returns Validated and transformed LlmConfig or null
 */
export function parseLlmConfig(dbConfig: unknown): LlmConfig {
  const result = LlmConfigSchema.safeParse(dbConfig);
  if (result.success) {
    return result.data;
  }
  // Log validation errors with field-level detail for debugging
  const invalidFields = result.error.issues.map(issue => issue.path.join('.'));
  logger.warn(
    {
      error: result.error.format(),
      invalidFields,
      receivedConfig: dbConfig,
    },
    'Failed to parse LLM config, using defaults'
  );
  return null;
}

/**
 * Database personality type with all raw fields from Prisma query
 */
export interface DatabasePersonality {
  id: string;
  name: string;
  displayName: string | null;
  slug: string;
  // Access control fields
  isPublic: boolean;
  ownerId: string | null;
  // Timestamp for avatar cache-busting
  updatedAt: Date;
  // Extended context tri-state: null=auto, true=on, false=off
  extendedContext: boolean | null;
  systemPrompt: {
    content: string;
  } | null;
  defaultConfigLink: {
    llmConfig: {
      model: string;
      visionModel: string | null;
      temperature: Decimal | null;
      topP: Decimal | null;
      topK: number | null;
      frequencyPenalty: Decimal | null;
      presencePenalty: Decimal | null;
      repetitionPenalty: Decimal | null;
      maxTokens: number | null;
      memoryScoreThreshold: Decimal | null;
      memoryLimit: number | null;
      contextWindowTokens: number;
    };
  } | null;
  // Character definition fields
  characterInfo: string;
  personalityTraits: string;
  personalityTone: string | null;
  personalityAge: string | null;
  personalityAppearance: string | null;
  personalityLikes: string | null;
  personalityDislikes: string | null;
  conversationalGoals: string | null;
  conversationalExamples: string | null;
  // Custom error message for this personality
  errorMessage: string | null;
}
