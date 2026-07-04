/**
 * Tests for Model Autocomplete utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelAutocompleteOption } from '@tzurot/common-types/types/ai';
import type { ServiceClient } from '@tzurot/clients';
import { InfraError, GatewayClientError } from '@tzurot/clients';
import { makeOk, makeErr } from '../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

// fetchModels now goes through the typed ServiceClient (auth-injecting transport)
// rather than a raw fetch, so mock the client, not global.fetch.
const getModelsMock = vi.fn();
vi.mock('./gatewayClients.js', () => ({
  getServiceClient: vi.fn(() => ({ getModels: getModelsMock }) as unknown as ServiceClient),
}));

import {
  fetchModels,
  fetchTextModels,
  fetchVisionModels,
  formatModelChoice,
} from './modelAutocomplete.js';

const sampleTextModels: ModelAutocompleteOption[] = [
  {
    id: 'anthropic/claude-sonnet-4',
    name: 'Anthropic: Claude Sonnet 4',
    contextLength: 200000,
    supportsVision: false,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 3,
    completionPricePerMillion: 15,
  },
];

const sampleVisionModels: ModelAutocompleteOption[] = [
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI: GPT-4o',
    contextLength: 128000,
    supportsVision: true,
    supportsImageGeneration: false,
    supportsAudioInput: false,
    supportsAudioOutput: false,
    promptPricePerMillion: 5,
    completionPricePerMillion: 15,
  },
];

function okModels(models: ModelAutocompleteOption[]) {
  return makeOk({ models, count: models.length });
}

describe('modelAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModelsMock.mockResolvedValue(okModels([]));
  });

  describe('fetchModels', () => {
    it('calls the typed client and returns its model list', async () => {
      getModelsMock.mockResolvedValue(okModels(sampleTextModels));

      const models = await fetchModels();

      expect(models).toEqual(sampleTextModels);
      expect(getModelsMock).toHaveBeenCalledWith({});
    });

    it('maps textOnly → outputModality=text', async () => {
      await fetchModels({ textOnly: true });
      expect(getModelsMock).toHaveBeenCalledWith({ outputModality: 'text' });
    });

    it('maps visionOnly → inputModality=image', async () => {
      await fetchModels({ visionOnly: true });
      expect(getModelsMock).toHaveBeenCalledWith({ inputModality: 'image' });
    });

    it('maps imageGenOnly → outputModality=image', async () => {
      await fetchModels({ imageGenOnly: true });
      expect(getModelsMock).toHaveBeenCalledWith({ outputModality: 'image' });
    });

    it('passes search and stringifies limit', async () => {
      await fetchModels({ search: 'claude', limit: 50 });
      expect(getModelsMock).toHaveBeenCalledWith({ search: 'claude', limit: '50' });
    });

    it('returns [] when the client returns an error result', async () => {
      getModelsMock.mockResolvedValue(makeErr(403, 'Service authentication failed'));
      expect(await fetchModels()).toEqual([]);
    });

    it('returns [] when the client throws', async () => {
      getModelsMock.mockRejectedValue(new Error('Network error'));
      expect(await fetchModels()).toEqual([]);
    });

    it('strict: throws InfraError on an infra failure (5xx) — not a silent []', async () => {
      getModelsMock.mockResolvedValue(makeErr(503, 'Bad Gateway'));
      await expect(fetchModels({ strict: true })).rejects.toThrow(InfraError);
    });

    it('strict: throws InfraError on a transport failure (status 0)', async () => {
      getModelsMock.mockResolvedValue(makeErr(0, 'timed out', undefined, 'timeout'));
      await expect(fetchModels({ strict: true })).rejects.toThrow(InfraError);
    });

    it('strict: throws GatewayClientError (not "try again") on a non-404 4xx', async () => {
      getModelsMock.mockResolvedValue(makeErr(403, 'Forbidden'));
      await expect(fetchModels({ strict: true })).rejects.toThrow(GatewayClientError);
    });

    it('strict: returns the model list on success', async () => {
      getModelsMock.mockResolvedValue(okModels(sampleTextModels));
      expect(await fetchModels({ strict: true })).toEqual(sampleTextModels);
    });
  });

  describe('fetchTextModels', () => {
    it('requests text models with the default limit', async () => {
      getModelsMock.mockResolvedValue(okModels(sampleTextModels));
      const models = await fetchTextModels();
      expect(getModelsMock).toHaveBeenCalledWith({ outputModality: 'text', limit: '25' });
      expect(models).toEqual(sampleTextModels);
    });

    it('includes the search query', async () => {
      await fetchTextModels('gpt');
      expect(getModelsMock).toHaveBeenCalledWith({
        outputModality: 'text',
        search: 'gpt',
        limit: '25',
      });
    });
  });

  describe('fetchVisionModels', () => {
    it('requests vision models with the default limit', async () => {
      getModelsMock.mockResolvedValue(okModels(sampleVisionModels));
      const models = await fetchVisionModels();
      expect(getModelsMock).toHaveBeenCalledWith({ inputModality: 'image', limit: '25' });
      expect(models).toEqual(sampleVisionModels);
    });
  });

  describe('formatModelChoice', () => {
    it('should format paid model with context length metadata', () => {
      const model: ModelAutocompleteOption = {
        id: 'anthropic/claude-sonnet-4',
        name: 'Anthropic: Claude Sonnet 4',
        contextLength: 200000,
        supportsVision: false,
        supportsImageGeneration: false,
        supportsAudioInput: false,
        supportsAudioOutput: false,
        promptPricePerMillion: 3,
        completionPricePerMillion: 15,
      };

      const choice = formatModelChoice(model);

      expect(choice.name).toBe('Anthropic: Claude Sonnet 4 · 200K');
      expect(choice.value).toBe('anthropic/claude-sonnet-4');
    });

    it('should format free model with FREE badge', () => {
      const model: ModelAutocompleteOption = {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        name: 'Meta: Llama 3.3 70B Instruct',
        contextLength: 128000,
        supportsVision: false,
        supportsImageGeneration: false,
        supportsAudioInput: false,
        supportsAudioOutput: false,
        promptPricePerMillion: 0,
        completionPricePerMillion: 0,
      };

      const choice = formatModelChoice(model);

      expect(choice.name).toBe('🆓 Meta: Llama 3.3 70B Instruct · 128K');
      expect(choice.value).toBe('meta-llama/llama-3.3-70b-instruct:free');
    });

    it('should format context length in millions', () => {
      const model: ModelAutocompleteOption = {
        id: 'google/gemini-2.5-pro',
        name: 'Google: Gemini 2.5 Pro',
        contextLength: 1000000,
        supportsVision: true,
        supportsImageGeneration: false,
        supportsAudioInput: false,
        supportsAudioOutput: false,
        promptPricePerMillion: 2.5,
        completionPricePerMillion: 10,
      };

      expect(formatModelChoice(model).name).toBe('Google: Gemini 2.5 Pro · 1M');
    });

    it('should truncate long names while preserving metadata', () => {
      const model: ModelAutocompleteOption = {
        id: 'some-provider/very-long-model-name-that-exceeds-the-limit',
        name: 'Some Provider: Very Long Model Name That Exceeds The Discord Limit And Should Be Truncated For Display',
        contextLength: 128000,
        supportsVision: false,
        supportsImageGeneration: false,
        supportsAudioInput: false,
        supportsAudioOutput: false,
        promptPricePerMillion: 1,
        completionPricePerMillion: 2,
      };

      const choice = formatModelChoice(model);

      expect(choice.name.length).toBeLessThanOrEqual(100);
      expect(choice.name).toContain('...');
      expect(choice.name).toContain('· 128K');
    });
  });
});
