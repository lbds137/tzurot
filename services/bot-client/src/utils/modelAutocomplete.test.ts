/**
 * Tests for Model Autocomplete utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModelAutocompleteOption } from '@tzurot/common-types';

// Mock dependencies before imports
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      GATEWAY_URL: 'http://localhost:3000',
    })),
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

import {
  fetchModels,
  fetchTextModels,
  fetchVisionModels,
  formatModelChoice,
} from './modelAutocomplete.js';
import { getConfig } from '@tzurot/common-types';

// Sample model data
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

describe('modelAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchModels', () => {
    it('should return empty array when gateway URL is not configured', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: undefined,
      } as ReturnType<typeof getConfig>);

      const models = await fetchModels();

      expect(models).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should fetch models from gateway', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: sampleTextModels, count: 2 }),
      });

      const models = await fetchModels();

      expect(models).toEqual(sampleTextModels);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/models',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should use /models/text endpoint when textOnly is true', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: sampleTextModels, count: 2 }),
      });

      await fetchModels({ textOnly: true });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/models/text',
        expect.any(Object)
      );
    });

    it('should use /models/vision endpoint when visionOnly is true', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: sampleVisionModels, count: 1 }),
      });

      await fetchModels({ visionOnly: true });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/models/vision',
        expect.any(Object)
      );
    });

    it('should use /models/image-generation endpoint when imageGenOnly is true', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [], count: 0 }),
      });

      await fetchModels({ imageGenOnly: true });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/models/image-generation',
        expect.any(Object)
      );
    });

    it('should include search parameter in query string', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [], count: 0 }),
      });

      await fetchModels({ search: 'claude' });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/models?search=claude',
        expect.any(Object)
      );
    });

    it('should include limit parameter in query string', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [], count: 0 }),
      });

      await fetchModels({ limit: 10 });

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/models?limit=10',
        expect.any(Object)
      );
    });

    it('should return empty array on fetch error', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

      const models = await fetchModels();

      expect(models).toEqual([]);
    });

    it('should return empty array on non-ok response', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
      });

      const models = await fetchModels();

      expect(models).toEqual([]);
    });
  });

  describe('fetchTextModels', () => {
    it('should fetch text models with default limit', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: sampleTextModels, count: 2 }),
      });

      const models = await fetchTextModels();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/models/text?limit=25',
        expect.any(Object)
      );
      expect(models).toEqual(sampleTextModels);
    });

    it('should include search query', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [], count: 0 }),
      });

      await fetchTextModels('gpt');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/models/text?search=gpt&limit=25',
        expect.any(Object)
      );
    });
  });

  describe('fetchVisionModels', () => {
    it('should fetch vision models with default limit', async () => {
      vi.mocked(getConfig).mockReturnValue({
        GATEWAY_URL: 'http://localhost:3000',
      } as ReturnType<typeof getConfig>);

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: sampleVisionModels, count: 1 }),
      });

      const models = await fetchVisionModels();

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/models/vision?limit=25',
        expect.any(Object)
      );
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

      // Paid models: no badge, just name and context
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

      // Free models: 🆓 badge prefix
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

      const choice = formatModelChoice(model);

      expect(choice.name).toBe('Google: Gemini 2.5 Pro · 1M');
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
      // formatAutocompleteOption preserves metadata suffix, truncates name portion with "..."
      expect(choice.name).toContain('...');
      expect(choice.name).toContain('· 128K');
    });
  });
});
