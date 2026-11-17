/**
 * Tests for promptCacheGateFires: the one statement of the prompt-caching gate.
 */

import { describe, it, expect } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { promptCacheGateFires } from './promptCacheGate.js';

describe('promptCacheGateFires', () => {
  const open = {
    provider: AIProvider.OpenRouter,
    promptCaching: true,
    modelName: 'anthropic/claude-sonnet-4',
  };

  it('fires when OpenRouter, promptCaching, and an anthropic-family id all hold', () => {
    expect(promptCacheGateFires(open)).toBe(true);
  });

  it('does not fire on a non-OpenRouter provider, even with the other two conditions', () => {
    expect(promptCacheGateFires({ ...open, provider: AIProvider.ZaiCoding })).toBe(false);
  });

  it('does not fire without the promptCaching opt-in (unset or false)', () => {
    expect(promptCacheGateFires({ ...open, promptCaching: undefined })).toBe(false);
    expect(promptCacheGateFires({ ...open, promptCaching: false })).toBe(false);
  });

  it('does not fire for a non-anthropic-family id, even with the other two conditions', () => {
    expect(promptCacheGateFires({ ...open, modelName: 'z-ai/glm-5.3' })).toBe(false);
  });
});
