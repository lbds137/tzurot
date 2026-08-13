import { describe, it, expect, vi } from 'vitest';

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => ({ NODE_ENV: 'test' }),
  };
});

// Hoisted singleton so log-field assertions can inspect what was emitted.
const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return { ...actual, createLogger: () => mockLogger };
});

import { detectNameCollision } from './PromptLogger.js';

describe('PromptLogger', () => {
  describe('detectNameCollision', () => {
    it('should return undefined when names do not match', () => {
      const result = detectNameCollision('Alice', 'alice#1234', 'Lilith', 'personality-1');
      expect(result).toBeUndefined();
    });

    it('should return collision info when names match (case-insensitive)', () => {
      const result = detectNameCollision('Lilith', 'lilith#1234', 'Lilith', 'personality-1');
      expect(result).toEqual({
        userName: 'Lilith',
        discordUsername: 'lilith#1234',
      });
    });

    it('should return collision info for different case', () => {
      const result = detectNameCollision('lilith', 'user#5678', 'Lilith', 'personality-1');
      expect(result).toEqual({
        userName: 'lilith',
        discordUsername: 'user#5678',
      });
    });

    it('should return undefined when activePersonaName is undefined', () => {
      const result = detectNameCollision(undefined, 'user#1234', 'Lilith', 'personality-1');
      expect(result).toBeUndefined();
    });

    it('should return undefined when activePersonaName is empty', () => {
      const result = detectNameCollision('', 'user#1234', 'Lilith', 'personality-1');
      expect(result).toBeUndefined();
    });

    it('should return undefined when names match but discordUsername is missing', () => {
      const result = detectNameCollision('Lilith', undefined, 'Lilith', 'personality-1');
      expect(result).toBeUndefined();
    });

    it('should return undefined when names match but discordUsername is empty', () => {
      const result = detectNameCollision('Lilith', '', 'Lilith', 'personality-1');
      expect(result).toBeUndefined();
    });

    it('logs the undiagnosable-collision error by personalityId, not by persona name', () => {
      mockLogger.error.mockClear();

      detectNameCollision('Lilith', undefined, 'Lilith', 'personality-1');

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const fields = mockLogger.error.mock.calls[0][0] as Record<string, unknown>;
      expect(fields).toEqual({ personalityId: 'personality-1' });
      expect(fields).not.toHaveProperty('activePersonaName');
    });
  });
});
