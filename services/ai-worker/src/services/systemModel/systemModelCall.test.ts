/**
 * Provider-routing tests for invokeSystemModel / resolveSystemModelRoute.
 *
 * These need getConfig mocked (zai vs openrouter routes), which is why they
 * live apart from the callers' own suites. Asserts what crosses the
 * createChatModel seam: provider, key, and the bare-vs-prefixed model id.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock('@tzurot/common-types/config/config', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/config/config')>();
  return { ...actual, getConfig: (): unknown => getConfigMock() };
});

const mockModelGenerate = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    generations: [
      [
        {
          text: '{"facts": []}',
          message: {
            content: '{"facts": []}',
            usage_metadata: { input_tokens: 10, output_tokens: 5 },
          },
        },
      ],
    ],
  })
);
const createChatModelMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    model: {
      generate: mockModelGenerate,
    },
    modelName: 'x',
  })
);
vi.mock('../ModelFactory.js', () => ({
  createChatModel: createChatModelMock,
}));

import { invokeSystemModel, resolveSystemModelRoute } from './systemModelCall.js';
import {
  registerSystemSettings,
  resetSystemSettingsRegistration,
  type SystemSettingsService,
} from '@tzurot/common-types/services/SystemSettingsService';

/** Register system model/provider fixtures through the ambient accessor. */
function setExtractionSettings(settings: { model?: string; provider?: string }): void {
  const values: Record<string, unknown> = {
    extractionModel: settings.model ?? 'z-ai/glm-5.2',
    extractionProvider: settings.provider ?? 'openrouter',
  };
  registerSystemSettings({
    get: (key: string) => values[key],
  } as unknown as SystemSettingsService);
}

afterEach(() => resetSystemSettingsRegistration());

const baseConfig = {
  ZAI_CODING_API_KEY: undefined as string | undefined,
};

describe('resolveSystemModelRoute', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes to z.ai with the system key when configured', () => {
    setExtractionSettings({ provider: 'zai-coding' });
    getConfigMock.mockReturnValue({ ...baseConfig, ZAI_CODING_API_KEY: 'zai-system-key' });
    expect(resolveSystemModelRoute()).toEqual({
      provider: 'zai-coding',
      apiKey: 'zai-system-key',
    });
  });

  it('falls back to OpenRouter when zai-coding is set WITHOUT a key (misconfiguration)', () => {
    setExtractionSettings({ provider: 'zai-coding' });
    getConfigMock.mockReturnValue(baseConfig);
    expect(resolveSystemModelRoute()).toEqual({ provider: 'openrouter' });
  });
});

describe('invokeSystemModel provider seam', () => {
  beforeEach(() => vi.clearAllMocks());

  it('z.ai route: system key attached and the z-ai/ prefix stripped to the bare model id', async () => {
    setExtractionSettings({ provider: 'zai-coding' });
    getConfigMock.mockReturnValue({ ...baseConfig, ZAI_CODING_API_KEY: 'zai-system-key' });

    const result = await invokeSystemModel('prompt', { appTitleSuffix: 'Test', timeoutMs: 1000 });

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
      // The SETTING's form, not the bare id the request carried. Callers write
      // this into usage_logs, whose model column has always recorded the
      // prefixed name regardless of which route billed it.
      model: 'z-ai/glm-5.2',
    });
  });

  it('z.ai route: strips a mixed-case z-ai/ prefix (widening — case-sensitive startsWith used to leave this unstripped and 400)', async () => {
    setExtractionSettings({ provider: 'zai-coding', model: 'Z-AI/glm-5' });
    getConfigMock.mockReturnValue({ ...baseConfig, ZAI_CODING_API_KEY: 'zai-system-key' });

    await invokeSystemModel('prompt', { appTitleSuffix: 'Test', timeoutMs: 1000 });

    expect(createChatModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelName: 'glm-5' })
    );
  });

  it('default route: OpenRouter keeps the prefixed model id and attaches no key', async () => {
    setExtractionSettings({});
    getConfigMock.mockReturnValue(baseConfig);

    await invokeSystemModel('prompt', { appTitleSuffix: 'Test', timeoutMs: 1000 });

    const args = createChatModelMock.mock.calls[0][0] as Record<string, unknown>;
    expect(args.modelName).toBe('z-ai/glm-5.2');
    expect(args.provider).toBe('openrouter');
    expect(args).not.toHaveProperty('apiKey');
    expect(args.appTitleSuffix).toBe('Test');
  });

  it('forwards the prompt and timeout across the model seam (generate, via invokeModelGuarded)', async () => {
    setExtractionSettings({});
    getConfigMock.mockReturnValue(baseConfig);

    await invokeSystemModel('the actual prompt text', {
      appTitleSuffix: 'Test',
      timeoutMs: 4242,
    });

    expect(mockModelGenerate).toHaveBeenCalledWith(
      [[expect.objectContaining({ content: 'the actual prompt text' })]],
      { timeout: 4242 },
      undefined
    );
  });

  it('a zero-choices 200 rejects as a classified EMPTY_RESPONSE instead of a TypeError', async () => {
    setExtractionSettings({});
    getConfigMock.mockReturnValue(baseConfig);
    mockModelGenerate.mockResolvedValueOnce({ generations: [[]] });

    await expect(
      invokeSystemModel('prompt', { appTitleSuffix: 'Test', timeoutMs: 1000 })
    ).rejects.toThrow('LLM returned empty response');
  });
});
