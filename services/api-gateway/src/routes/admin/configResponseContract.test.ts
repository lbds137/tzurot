/**
 * Admin config response-contract tests.
 *
 * These guard the class of regression where an admin/global config handler
 * emits a response body that VIOLATES its own declared output schema — and the
 * violation stays invisible because the per-handler unit tests mock the typed
 * client (or assert only individual fields), never validating the whole body
 * against the contract the bot-client actually enforces at the transport layer.
 *
 * The concrete failure this was written to catch: the admin LLM/TTS routes
 * formatted a config WITHOUT `isOwned`/`permissions`, both REQUIRED by
 * `LlmConfigSummarySchema`/`TtsConfigSummarySchema`. The owner-client's
 * `safeParse` rejected the body (→ `{ok:false}`), breaking `/preset global`
 * and the TTS-global flows — but every unit test mocked above the validation
 * boundary, so nothing failed.
 *
 * Strategy: mount the REAL route aggregators with a mocked Prisma (so the real
 * service + formatter run), drive each endpoint through supertest, and assert
 * the emitted body parses against `ROUTE_MANIFEST[id].output` — the same schema
 * the generated client validates with. LIST / GET / CREATE / UPDATE — every
 * config-emitting admin verb — is covered for both resources.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { ROUTE_MANIFEST } from '@tzurot/clients';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

// Owner-gate passthrough: set an admin Discord ID and continue.
vi.mock('../../services/AuthMiddleware.js', () => ({
  requireOwnerAuth: () => (req: { userId?: string }, _res: unknown, next: () => void) => {
    req.userId = 'admin-discord-id';
    next();
  },
}));

// Force model-field validation to pass so the LLM create/update paths reach
// the response-shaping step without orchestrating a model cache.
vi.mock('../../utils/llmConfigValidation.js', () => ({
  validateLlmConfigModelFields: vi.fn().mockResolvedValue(true),
}));

import { createAdminLlmConfigRoutes } from './llm-config.js';
import { createAdminTtsConfigRoutes } from './tts-config.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

// A valid RFC-4122 UUID — `LlmConfigSummarySchema.id` / `TtsConfigSummarySchema.id`
// validate with `.uuid()`, so fixtures MUST use a conformant value (the existing
// per-handler tests use `config-1`, which would trip the uuid check here).
const UUID = '550e8400-e29b-41d4-a716-446655440000';

/** Assert a captured body parses cleanly against a route's declared output schema. */
function expectSatisfiesContract(routeId: keyof typeof ROUTE_MANIFEST, body: unknown): void {
  const schema = ROUTE_MANIFEST[routeId].output;
  if (schema === undefined) {
    throw new Error(`Route ${String(routeId)} has no output schema to validate against`);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`${String(routeId)} response violates its output schema → ${issues}`);
  }
}

/** Every admin config response must carry the owner-gated ownership fields. */
function expectAdminOwnership(config: { isOwned?: unknown; permissions?: unknown }): void {
  expect(config.isOwned).toBe(true);
  expect(config.permissions).toEqual({ canEdit: true, canDelete: true });
}

describe('Admin LLM config response contract', () => {
  const llmListRow = {
    id: UUID,
    name: 'Default Config',
    description: 'System default',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4',
    isGlobal: true,
    isDefault: true,
    isFreeDefault: false,
    ownerId: 'admin-user-id',
  };

  const llmDetailRow = {
    ...llmListRow,
    advancedParameters: { temperature: 0.7, reasoning: { effort: 'high', max_tokens: 8000 } },
    contextWindowTokens: 8000,
  };

  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'admin-user-id' }) },
      llmConfig: {
        findMany: vi.fn().mockResolvedValue([llmListRow]),
        // update's existing-guard selects {id,name,isGlobal}; the detail row is a superset.
        findUnique: vi.fn().mockResolvedValue(llmDetailRow),
        findFirst: vi.fn().mockResolvedValue(null), // no name collision
        create: vi.fn().mockResolvedValue(llmDetailRow),
        update: vi.fn().mockResolvedValue(llmDetailRow),
      },
      // list() derives the default flags from the pointers via findUnique.
      adminSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    app = express();
    app.use(express.json());
    app.use('/admin/llm-config', createAdminLlmConfigRoutes({ ...stubRouteResolvers(), prisma }));
  });

  it('GET /admin/llm-config satisfies listGlobalLlmConfigs output schema', async () => {
    const res = await request(app).get('/admin/llm-config');
    expect(res.status).toBe(200);
    expectSatisfiesContract('listGlobalLlmConfigs', res.body);
    expectAdminOwnership(res.body.configs[0]);
    // Internal column must not leak into the list response.
    expect(res.body.configs[0].ownerId).toBeUndefined();
  });

  it('GET /admin/llm-config/:id satisfies getGlobalLlmConfig output schema', async () => {
    const res = await request(app).get(`/admin/llm-config/${UUID}`);
    expect(res.status).toBe(200);
    expectSatisfiesContract('getGlobalLlmConfig', res.body);
    expectAdminOwnership(res.body.config);
  });

  it('POST /admin/llm-config satisfies createGlobalLlmConfig output schema', async () => {
    const res = await request(app)
      .post('/admin/llm-config')
      .send({ name: 'New Config', model: 'anthropic/claude-sonnet-4' });
    expect(res.status).toBe(201);
    expectSatisfiesContract('createGlobalLlmConfig', res.body);
    expectAdminOwnership(res.body.config);
  });

  it('PUT /admin/llm-config/:id satisfies updateGlobalLlmConfig output schema', async () => {
    const res = await request(app).put(`/admin/llm-config/${UUID}`).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
    expectSatisfiesContract('updateGlobalLlmConfig', res.body);
    expectAdminOwnership(res.body.config);
  });
});

describe('Admin TTS config response contract', () => {
  // Rows come back from Prisma WITHOUT the stale flag columns (no longer
  // selected); the service decorates with pointer-derived flags.
  const ttsListRow = {
    id: UUID,
    name: 'My Voice',
    description: null,
    provider: 'elevenlabs' as const,
    modelId: 'eleven_multilingual_v2',
    isGlobal: true,
    ownerId: 'admin-user-id',
  };

  const ttsDetailRow = { ...ttsListRow, advancedParameters: null };

  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'admin-user-id' }) },
      ttsConfig: {
        findMany: vi.fn().mockResolvedValue([ttsListRow]),
        findUnique: vi.fn().mockResolvedValue(ttsDetailRow),
        findFirst: vi.fn().mockResolvedValue(null), // no name collision
        create: vi.fn().mockResolvedValue(ttsDetailRow),
        update: vi.fn().mockResolvedValue(ttsDetailRow),
      },
      // Flag derivation + the delete guard read the AdminSettings pointers.
      adminSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    app = express();
    app.use(express.json());
    app.use('/admin/tts-config', createAdminTtsConfigRoutes({ ...stubRouteResolvers(), prisma }));
  });

  it('GET /admin/tts-config satisfies listGlobalTtsConfigs output schema', async () => {
    const res = await request(app).get('/admin/tts-config');
    expect(res.status).toBe(200);
    expectSatisfiesContract('listGlobalTtsConfigs', res.body);
    expectAdminOwnership(res.body.configs[0]);
    expect(res.body.configs[0].ownerId).toBeUndefined();
  });

  it('GET /admin/tts-config/:id satisfies getGlobalTtsConfig output schema', async () => {
    const res = await request(app).get(`/admin/tts-config/${UUID}`);
    expect(res.status).toBe(200);
    expectSatisfiesContract('getGlobalTtsConfig', res.body);
    expectAdminOwnership(res.body.config);
  });

  it('POST /admin/tts-config satisfies createGlobalTtsConfig output schema', async () => {
    const res = await request(app)
      .post('/admin/tts-config')
      .send({ name: 'New Voice', provider: 'elevenlabs' });
    expect(res.status).toBe(201);
    expectSatisfiesContract('createGlobalTtsConfig', res.body);
    expectAdminOwnership(res.body.config);
  });

  it('PUT /admin/tts-config/:id satisfies updateGlobalTtsConfig output schema', async () => {
    const res = await request(app).put(`/admin/tts-config/${UUID}`).send({ name: 'Renamed Voice' });
    expect(res.status).toBe(200);
    expectSatisfiesContract('updateGlobalTtsConfig', res.body);
    expectAdminOwnership(res.body.config);
  });
});
