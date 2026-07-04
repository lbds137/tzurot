import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { ModelAutocompleteOption } from '@tzurot/common-types/types/ai';
import { handleGetModels } from './models.js';
import type { OpenRouterModelCache } from '../../services/OpenRouterModelCache.js';
import type { RouteDeps } from '../routeDeps.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const SAMPLE: ModelAutocompleteOption = {
  id: 'anthropic/claude-sonnet-4',
  name: 'Claude Sonnet 4',
  contextLength: 200_000,
  supportsVision: false,
  supportsImageGeneration: false,
  supportsAudioInput: false,
  supportsAudioOutput: false,
  promptPricePerMillion: 3,
  completionPricePerMillion: 15,
};

describe('GET /api/internal/models', () => {
  let getFilteredModels: ReturnType<typeof vi.fn>;
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    getFilteredModels = vi.fn().mockResolvedValue([SAMPLE]);
    const deps = {
      modelCache: { getFilteredModels } as unknown as OpenRouterModelCache,
    } as RouteDeps;
    app = express();
    app.get('/api/internal/models', handleGetModels(deps));
  });

  it('returns the filtered model list with a count', async () => {
    const res = await request(app).get('/api/internal/models');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ models: [SAMPLE], count: 1 });
  });

  it('passes modality + search + limit through to the cache', async () => {
    await request(app).get(
      '/api/internal/models?inputModality=image&outputModality=text&search=claude&limit=50'
    );
    expect(getFilteredModels).toHaveBeenCalledWith({
      inputModality: 'image',
      outputModality: 'text',
      search: 'claude',
      limit: 50,
    });
  });

  it('caps limit at 1000', async () => {
    await request(app).get('/api/internal/models?limit=5000');
    expect(getFilteredModels).toHaveBeenCalledWith(expect.objectContaining({ limit: 1000 }));
  });

  it('falls back to the default limit for a non-numeric limit', async () => {
    await request(app).get('/api/internal/models?limit=abc');
    expect(getFilteredModels).toHaveBeenCalledWith(expect.objectContaining({ limit: 25 }));
  });

  it('rejects an invalid modality', async () => {
    const res = await request(app).get('/api/internal/models?inputModality=bogus');
    expect(res.status).toBe(400);
    expect(getFilteredModels).not.toHaveBeenCalled();
  });

  it('returns 503 when the model cache is absent (defensive guard)', async () => {
    const bareApp = express();
    bareApp.get('/api/internal/models', handleGetModels({} as RouteDeps));
    const res = await request(bareApp).get('/api/internal/models');
    expect(res.status).toBe(503);
  });
});
