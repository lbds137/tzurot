/**
 * Tests for the models API schemas, incl. a type-parity guard against the
 * `ModelAutocompleteOption` interface so the Zod schema can't drift from it.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { ModelAutocompleteOptionSchema, ModelsListResponseSchema } from './models.js';
import type { ModelAutocompleteOption } from '../../types/ai.js';

// Compile-time parity: the inferred schema type and the interface must be
// mutually assignable. If a field is added/removed/retyped on either side
// without updating the other, one of these assignments fails typecheck.
type Inferred = z.infer<typeof ModelAutocompleteOptionSchema>;
const _schemaMatchesInterface: ModelAutocompleteOption = {} as Inferred;
const _interfaceMatchesSchema: Inferred = {} as ModelAutocompleteOption;
void _schemaMatchesInterface;
void _interfaceMatchesSchema;

const VALID: ModelAutocompleteOption = {
  id: 'anthropic/claude-sonnet-4',
  name: 'Claude Sonnet 4',
  contextLength: 200_000,
  supportsVision: true,
  supportsImageGeneration: false,
  supportsAudioInput: false,
  supportsAudioOutput: false,
  promptPricePerMillion: 3,
  completionPricePerMillion: 15,
};

describe('ModelAutocompleteOptionSchema', () => {
  it('accepts a valid model option', () => {
    expect(ModelAutocompleteOptionSchema.safeParse(VALID).success).toBe(true);
  });

  it('rejects a wrong field type', () => {
    expect(
      ModelAutocompleteOptionSchema.safeParse({ ...VALID, contextLength: '200000' }).success
    ).toBe(false);
  });
});

describe('ModelsListResponseSchema', () => {
  it('accepts a models list with a count', () => {
    expect(ModelsListResponseSchema.safeParse({ models: [VALID], count: 1 }).success).toBe(true);
  });

  it('rejects a non-array models field', () => {
    expect(ModelsListResponseSchema.safeParse({ models: VALID, count: 1 }).success).toBe(false);
  });
});
