/**
 * Seam test: `makeArchiveSummaryInvoker` forwards `thinking: 'off'` and
 * `maxTokens` across the `createChatModel` boundary, and bills the route it
 * was built with rather than one `resolveSystemModelRoute` would resolve
 * live. Lives apart from `ArchiveSummaryProcessor.test.ts` because it needs
 * the FULL model-call chain mocked (createChatModel + generate), not just
 * `resolveSystemModelRoute`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockModelGenerate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    generations: [
      [
        {
          text: '{"summary": "x"}',
          message: {
            content: '{"summary": "x"}',
            usage_metadata: { input_tokens: 1, output_tokens: 1 },
          },
        },
      ],
    ],
  })
);
const createChatModelMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({ model: { generate: mockModelGenerate }, modelName: 'x' })
);
vi.mock('../ModelFactory.js', () => ({ createChatModel: createChatModelMock }));

import { AIProvider } from '@tzurot/common-types/constants/ai';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';
import { makeArchiveSummaryInvoker } from './makeArchiveSummaryInvoker.js';

describe('makeArchiveSummaryInvoker', () => {
  beforeEach(() => {
    registerSystemSettings({
      get: (key: string) =>
        key === 'extractionModel'
          ? 'z-ai/glm-5.2'
          : key === 'extractionProvider'
            ? 'openrouter'
            : undefined,
    } as unknown as SystemSettingsService);
  });

  afterEach(() => resetSystemSettingsRegistration());

  it('forwards thinking: off and a maxTokens cap to createChatModel', async () => {
    await makeArchiveSummaryInvoker({ provider: AIProvider.ZaiCoding, apiKey: 'gate-key' })(
      'prompt'
    );

    expect(createChatModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ thinking: 'off', maxTokens: 512 })
    );
  });

  it('bills the route the gate accepted, not what resolveSystemModelRoute would now return', async () => {
    // extractionProvider is 'openrouter' — resolveSystemModelRoute() would
    // return OpenRouter — but the invoker was built with a zai-coding route.
    await makeArchiveSummaryInvoker({ provider: AIProvider.ZaiCoding, apiKey: 'gate-key' })(
      'prompt'
    );

    expect(createChatModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'zai-coding',
        apiKey: 'gate-key',
        modelName: 'glm-5.2',
      })
    );
  });
});
