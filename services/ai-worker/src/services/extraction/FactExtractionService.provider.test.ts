/**
 * Provider-routing tests for invokeExtractionModel / resolveExtractionProvider.
 *
 * Separate from FactExtractionService.test.ts because these need getConfig
 * mocked (zai vs openrouter routes), while that file's tests rely on the real
 * test config. Asserts what crosses the createChatModel seam: provider, key,
 * and the bare-vs-prefixed model id.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types/config/config', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/config/config')>();
  return { ...actual, getConfig: (): unknown => getConfigMock() };
});

const createChatModelMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    model: {
      invoke: vi.fn().mockResolvedValue({
        content: '{"facts": []}',
        usage_metadata: { input_tokens: 10, output_tokens: 5 },
      }),
    },
    modelName: 'x',
  })
);
vi.mock('../ModelFactory.js', () => ({
  createChatModel: createChatModelMock,
}));

import { invokeExtractionModel, resolveExtractionProvider } from './FactExtractionService.js';

const baseConfig = {
  EXTRACTION_MODEL: 'z-ai/glm-5.2',
  EXTRACTION_PROVIDER: 'openrouter',
  ZAI_CODING_API_KEY: undefined as string | undefined,
};

describe('resolveExtractionProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes to z.ai with the system key when configured', () => {
    getConfigMock.mockReturnValue({
      ...baseConfig,
      EXTRACTION_PROVIDER: 'zai-coding',
      ZAI_CODING_API_KEY: 'zai-system-key',
    });
    expect(resolveExtractionProvider()).toEqual({
      provider: 'zai-coding',
      apiKey: 'zai-system-key',
    });
  });

  it('falls back to OpenRouter when zai-coding is set WITHOUT a key (misconfiguration)', () => {
    getConfigMock.mockReturnValue({ ...baseConfig, EXTRACTION_PROVIDER: 'zai-coding' });
    expect(resolveExtractionProvider()).toEqual({ provider: 'openrouter' });
  });
});

describe('invokeExtractionModel provider seam', () => {
  beforeEach(() => vi.clearAllMocks());

  it('z.ai route: system key attached and the z-ai/ prefix stripped to the bare model id', async () => {
    getConfigMock.mockReturnValue({
      ...baseConfig,
      EXTRACTION_PROVIDER: 'zai-coding',
      ZAI_CODING_API_KEY: 'zai-system-key',
    });

    const result = await invokeExtractionModel('prompt');

    expect(createChatModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        modelName: 'glm-5.2', // bare — z.ai-direct rejects the OpenRouter prefix
        provider: 'zai-coding',
        apiKey: 'zai-system-key',
      })
    );
    expect(result).toEqual({
      content: '{"facts": []}',
      tokensIn: 10,
      tokensOut: 5,
      provider: 'zai-coding',
    });
  });

  it('default route: OpenRouter keeps the prefixed model id and attaches no key', async () => {
    getConfigMock.mockReturnValue(baseConfig);

    await invokeExtractionModel('prompt');

    const args = createChatModelMock.mock.calls[0][0] as Record<string, unknown>;
    expect(args.modelName).toBe('z-ai/glm-5.2');
    expect(args.provider).toBe('openrouter');
    expect(args).not.toHaveProperty('apiKey');
    expect(args.appTitleSuffix).toBe('Extraction');
  });
});
