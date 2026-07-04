import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import type { Response } from 'express';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

const mockSendError = vi.fn();
const mockSendZodError = vi.fn();

vi.mock('./responseHelpers.js', () => ({
  sendError: (...args: unknown[]) => mockSendError(...args),
}));

vi.mock('./zodHelpers.js', () => ({
  sendZodError: (...args: unknown[]) => mockSendZodError(...args),
}));

vi.mock('./errorResponses.js', () => ({
  ErrorResponses: {
    notFound: (resource: string) => ({ error: 'NOT_FOUND', message: `${resource} not found` }),
    validationError: (msg: string) => ({ error: 'VALIDATION_ERROR', message: msg }),
    unauthorized: (msg: string) => ({ error: 'UNAUTHORIZED', message: msg }),
    nameCollision: (msg: string) => ({
      error: 'VALIDATION_ERROR',
      message: msg,
      code: 'NAME_COLLISION',
    }),
  },
}));

import {
  parseBodyOrSendError,
  parseConfigKindQuery,
  parseConfigKindQueryAllowAll,
  findConfigOrSendNotFound,
  findGlobalConfigOrSendError,
  findAdminUserOrSendError,
  ensureNoNameCollision,
  shapeDeleteResponse,
  withAdminOwnership,
} from './configRouteHelpers.js';

const mockRes = {} as Response;

beforeEach(() => vi.resetAllMocks());

describe('parseConfigKindQuery', () => {
  it('returns the parsed kind for a valid ?kind=vision', () => {
    expect(parseConfigKindQuery(mockRes, { kind: 'vision' })).toBe('vision');
    expect(mockSendZodError).not.toHaveBeenCalled();
  });

  it('returns text for a valid ?kind=text', () => {
    expect(parseConfigKindQuery(mockRes, { kind: 'text' })).toBe('text');
  });

  it('defaults to text when the param is absent', () => {
    expect(parseConfigKindQuery(mockRes, {})).toBe('text');
    expect(mockSendZodError).not.toHaveBeenCalled();
  });

  it('defaults to text when the query object itself is undefined', () => {
    // Express always populates req.query, but the helper must not 400 purely
    // because the object is missing (e.g. in unit tests / edge cases).
    expect(parseConfigKindQuery(mockRes, undefined)).toBe('text');
    expect(mockSendZodError).not.toHaveBeenCalled();
  });

  it('sends a Zod error and returns null for an invalid kind', () => {
    expect(parseConfigKindQuery(mockRes, { kind: 'audio' })).toBeNull();
    expect(mockSendZodError).toHaveBeenCalledTimes(1);
  });
});

describe('parseConfigKindQueryAllowAll', () => {
  it('returns the parsed kind for a valid ?kind=vision', () => {
    expect(parseConfigKindQueryAllowAll(mockRes, { kind: 'vision' })).toBe('vision');
    expect(mockSendZodError).not.toHaveBeenCalled();
  });

  it('returns text for a valid ?kind=text', () => {
    expect(parseConfigKindQueryAllowAll(mockRes, { kind: 'text' })).toBe('text');
  });

  it('accepts the all-kinds sentinel ?kind=all (list-only widening)', () => {
    expect(parseConfigKindQueryAllowAll(mockRes, { kind: 'all' })).toBe('all');
    expect(mockSendZodError).not.toHaveBeenCalled();
  });

  it('defaults to text when the param is absent', () => {
    expect(parseConfigKindQueryAllowAll(mockRes, {})).toBe('text');
    expect(mockSendZodError).not.toHaveBeenCalled();
  });

  it('sends a Zod error and returns null for an invalid kind', () => {
    expect(parseConfigKindQueryAllowAll(mockRes, { kind: 'audio' })).toBeNull();
    expect(mockSendZodError).toHaveBeenCalledTimes(1);
  });
});

describe('parseBodyOrSendError', () => {
  const schema = z.object({ name: z.string(), count: z.number() });

  it('returns parsed value on success', () => {
    const result = parseBodyOrSendError(mockRes, schema, { name: 'alice', count: 3 });
    expect(result).toEqual({ name: 'alice', count: 3 });
    expect(mockSendZodError).not.toHaveBeenCalled();
  });

  it('returns null and calls sendZodError on failure', () => {
    const result = parseBodyOrSendError(mockRes, schema, { name: 'alice' });
    expect(result).toBeNull();
    expect(mockSendZodError).toHaveBeenCalledOnce();
  });

  it('returns null and calls sendZodError when body is null', () => {
    const result = parseBodyOrSendError(mockRes, schema, null);
    expect(result).toBeNull();
    expect(mockSendZodError).toHaveBeenCalledOnce();
  });
});

describe('findConfigOrSendNotFound', () => {
  it('returns the row when fetch resolves to a value', async () => {
    const row = { id: 'r1', ownerId: 'u1', name: 'User config' };
    const fetchRow = vi.fn().mockResolvedValue(row);

    const result = await findConfigOrSendNotFound(mockRes, fetchRow, 'Config');

    expect(result).toBe(row);
    expect(mockSendError).not.toHaveBeenCalled();
  });

  it('sends 404 and returns null when fetch resolves to null', async () => {
    const fetchRow = vi.fn().mockResolvedValue(null);

    const result = await findConfigOrSendNotFound(mockRes, fetchRow, 'TtsConfig');

    expect(result).toBeNull();
    expect(mockSendError).toHaveBeenCalledWith(
      mockRes,
      expect.objectContaining({ error: 'NOT_FOUND', message: 'TtsConfig not found' })
    );
  });
});

describe('findGlobalConfigOrSendError', () => {
  const baseOptions = {
    notFoundResource: 'Config',
    resourceLabel: 'configs',
  } as const;

  it('returns the row when it exists and isGlobal is true', async () => {
    const row = { id: 'r1', isGlobal: true, name: 'Global Default' };
    const fetchRow = vi.fn().mockResolvedValue(row);

    const result = await findGlobalConfigOrSendError(mockRes, fetchRow, {
      ...baseOptions,
      operation: 'edit',
    });

    expect(result).toBe(row);
    expect(mockSendError).not.toHaveBeenCalled();
  });

  it('sends 404 and returns null when row is null', async () => {
    const fetchRow = vi.fn().mockResolvedValue(null);

    const result = await findGlobalConfigOrSendError(mockRes, fetchRow, {
      ...baseOptions,
      operation: 'edit',
    });

    expect(result).toBeNull();
    expect(mockSendError).toHaveBeenCalledWith(
      mockRes,
      expect.objectContaining({ error: 'NOT_FOUND', message: 'Config not found' })
    );
  });

  it('sends validation error and returns null when isGlobal is false', async () => {
    const row = { id: 'r1', isGlobal: false, name: 'User config' };
    const fetchRow = vi.fn().mockResolvedValue(row);

    const result = await findGlobalConfigOrSendError(mockRes, fetchRow, {
      ...baseOptions,
      operation: 'delete',
    });

    expect(result).toBeNull();
    expect(mockSendError).toHaveBeenCalledWith(
      mockRes,
      expect.objectContaining({ message: 'Can only delete global configs' })
    );
  });

  it.each([
    ['edit', 'Can only edit global configs'],
    ['delete', 'Can only delete global configs'],
    ['set as system default', 'Only global configs can be set as system default'],
    ['set as free tier default', 'Only global configs can be set as free tier default'],
  ] as const)(
    'formats operation %s with the resource label',
    async (operation, expectedMessage) => {
      const fetchRow = vi.fn().mockResolvedValue({ id: 'x', isGlobal: false });

      await findGlobalConfigOrSendError(mockRes, fetchRow, { ...baseOptions, operation });

      expect(mockSendError).toHaveBeenCalledWith(
        mockRes,
        expect.objectContaining({ message: expectedMessage })
      );
    }
  );

  it('respects a custom resourceLabel (e.g., "TTS configs")', async () => {
    const fetchRow = vi.fn().mockResolvedValue({ id: 'x', isGlobal: false });

    await findGlobalConfigOrSendError(mockRes, fetchRow, {
      notFoundResource: 'TtsConfig',
      resourceLabel: 'TTS configs',
      operation: 'edit',
    });

    expect(mockSendError).toHaveBeenCalledWith(
      mockRes,
      expect.objectContaining({ message: 'Can only edit global TTS configs' })
    );
  });
});

describe('findAdminUserOrSendError', () => {
  const mockLogger = { warn: vi.fn() };
  // Module-level `beforeEach(() => vi.resetAllMocks())` already clears
  // mockLogger.warn; no inner reset needed.

  it('returns the admin user when found', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'internal-uuid-123' });
    const prisma = { user: { findUnique } } as unknown as PrismaClient;

    const result = await findAdminUserOrSendError(mockRes, prisma, 'discord-456', mockLogger);

    expect(result).toEqual({ id: 'internal-uuid-123' });
    expect(findUnique).toHaveBeenCalledWith({
      where: { discordId: 'discord-456' },
      select: { id: true },
    });
    expect(mockSendError).not.toHaveBeenCalled();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('sends unauthorized and logs warning when admin user not found', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const prisma = { user: { findUnique } } as unknown as PrismaClient;

    const result = await findAdminUserOrSendError(mockRes, prisma, 'discord-456', mockLogger);

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { discordUserId: 'discord-456' },
      'Admin user not found in database'
    );
    expect(mockSendError).toHaveBeenCalledWith(
      mockRes,
      expect.objectContaining({
        error: 'UNAUTHORIZED',
        message: 'Admin user not found in database',
      })
    );
  });
});

describe('ensureNoNameCollision', () => {
  const globalScope = { type: 'GLOBAL' as const };
  const userScope = { type: 'USER' as const, userId: 'u-123', discordId: 'd-456' };

  it('returns true when no collision exists', async () => {
    const service = {
      checkNameExists: vi.fn().mockResolvedValue({ exists: false }),
    };

    const result = await ensureNoNameCollision(mockRes, service, {
      name: 'NewName',
      scope: globalScope,
      excludeId: undefined,
      formatCollisionMessage: n => `A global config named "${n}" already exists`,
    });

    expect(result).toBe(true);
    expect(service.checkNameExists).toHaveBeenCalledWith(
      'NewName',
      globalScope,
      undefined,
      undefined,
      undefined
    );
    expect(mockSendError).not.toHaveBeenCalled();
  });

  it('sends name-collision error and returns false when collision exists', async () => {
    const service = {
      checkNameExists: vi.fn().mockResolvedValue({ exists: true }),
    };

    const result = await ensureNoNameCollision(mockRes, service, {
      name: 'TakenName',
      scope: globalScope,
      excludeId: undefined,
      formatCollisionMessage: n => `A global TTS config named "${n}" already exists`,
    });

    expect(result).toBe(false);
    expect(mockSendError).toHaveBeenCalledWith(
      mockRes,
      expect.objectContaining({
        code: 'NAME_COLLISION',
        message: 'A global TTS config named "TakenName" already exists',
      })
    );
  });

  it('passes excludeId through to the service when editing', async () => {
    const service = {
      checkNameExists: vi.fn().mockResolvedValue({ exists: false }),
    };

    await ensureNoNameCollision(mockRes, service, {
      name: 'RenameTarget',
      scope: globalScope,
      excludeId: 'existing-id-789',
      formatCollisionMessage: n => `A global config named "${n}" already exists`,
    });

    expect(service.checkNameExists).toHaveBeenCalledWith(
      'RenameTarget',
      globalScope,
      'existing-id-789',
      undefined,
      undefined
    );
  });

  it('forwards user-scope unchanged to the service', async () => {
    const service = {
      checkNameExists: vi.fn().mockResolvedValue({ exists: false }),
    };

    await ensureNoNameCollision(mockRes, service, {
      name: 'MyConfig',
      scope: userScope,
      excludeId: undefined,
      formatCollisionMessage: n => `You already have a config named "${n}"`,
    });

    expect(service.checkNameExists).toHaveBeenCalledWith(
      'MyConfig',
      userScope,
      undefined,
      undefined,
      undefined
    );
  });

  it('uses the caller-provided formatter for the collision message', async () => {
    const service = {
      checkNameExists: vi.fn().mockResolvedValue({ exists: true }),
    };

    await ensureNoNameCollision(mockRes, service, {
      name: 'Duplicate',
      scope: userScope,
      excludeId: undefined,
      formatCollisionMessage: n => `You already have a config named "${n}"`,
    });

    expect(mockSendError).toHaveBeenCalledWith(
      mockRes,
      expect.objectContaining({
        message: 'You already have a config named "Duplicate"',
      })
    );
  });

  it('forwards postIsGlobal to the service for cross-namespace global checks', async () => {
    const service = {
      checkNameExists: vi.fn().mockResolvedValue({ exists: false }),
    };

    await ensureNoNameCollision(mockRes, service, {
      name: 'Renamed',
      scope: userScope,
      excludeId: 'cfg-1',
      postIsGlobal: true,
      formatCollisionMessage: _n => `irrelevant`,
    });

    expect(service.checkNameExists).toHaveBeenCalledWith(
      'Renamed',
      userScope,
      'cfg-1',
      true,
      undefined
    );
  });

  it('does not pass postIsGlobal when omitted (service receives undefined 4th arg)', async () => {
    const service = {
      checkNameExists: vi.fn().mockResolvedValue({ exists: false }),
    };

    await ensureNoNameCollision(mockRes, service, {
      name: 'Created',
      scope: userScope,
      formatCollisionMessage: _n => `irrelevant`,
    });

    expect(service.checkNameExists).toHaveBeenCalledWith(
      'Created',
      userScope,
      undefined,
      undefined,
      undefined
    );
  });

  it('forwards kind to the service so collision checks are kind-scoped', async () => {
    const service = {
      checkNameExists: vi.fn().mockResolvedValue({ exists: false }),
    };

    await ensureNoNameCollision(mockRes, service, {
      name: 'VisionPreset',
      scope: globalScope,
      kind: 'vision',
      formatCollisionMessage: _n => `irrelevant`,
    });

    expect(service.checkNameExists).toHaveBeenCalledWith(
      'VisionPreset',
      globalScope,
      undefined,
      undefined,
      'vision'
    );
  });
});

describe('shapeDeleteResponse', () => {
  it('omits warning from body and log fields when warning is null', () => {
    const result = shapeDeleteResponse(null, { configId: 'c1', name: 'X' });

    expect(result.responseBody).toEqual({ deleted: true });
    expect(result.logFields).toEqual({ configId: 'c1', name: 'X' });
    expect(result.logFields).not.toHaveProperty('warning');
  });

  it('includes warning in body and log fields when warning is a string', () => {
    const result = shapeDeleteResponse('3 users will have their default reset', {
      configId: 'c1',
      name: 'X',
    });

    expect(result.responseBody).toEqual({
      deleted: true,
      warning: '3 users will have their default reset',
    });
    expect(result.logFields).toEqual({
      configId: 'c1',
      name: 'X',
      warning: '3 users will have their default reset',
    });
  });

  it('treats empty-string warning as a value (does not collapse to clean shape)', () => {
    // Documents an intentional sharp edge: only `null` is the "no warning"
    // sentinel. An empty string flows through unchanged so the caller can
    // distinguish "no warning" from "warning was explicitly empty."
    const result = shapeDeleteResponse('', { configId: 'c1' });

    expect(result.responseBody).toEqual({ deleted: true, warning: '' });
    expect(result.logFields).toEqual({ configId: 'c1', warning: '' });
  });
});

describe('withAdminOwnership', () => {
  it('attaches isOwned:true and full permissions to a formatted config', () => {
    const result = withAdminOwnership({ id: 'abc', name: 'Global Preset' });

    expect(result).toEqual({
      id: 'abc',
      name: 'Global Preset',
      isOwned: true,
      permissions: { canEdit: true, canDelete: true },
    });
  });

  it('preserves all formatted fields alongside the ownership fields', () => {
    const result = withAdminOwnership({
      id: 'abc',
      name: 'X',
      model: 'm',
      isDefault: true,
      params: { temperature: 0.7 },
    });

    expect(result).toMatchObject({ id: 'abc', name: 'X', model: 'm', isDefault: true });
    expect(result.params).toEqual({ temperature: 0.7 });
    expect(result.isOwned).toBe(true);
  });
});
