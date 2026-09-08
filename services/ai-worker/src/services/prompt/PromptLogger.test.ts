import { describe, it, expect, vi, beforeEach } from 'vitest';

// PromptLogger captures `getConfig()` once at module level, so the mock hands
// back ONE mutable object that per-case setup rewrites in place.
const mockConfig = vi.hoisted(() => ({
  NODE_ENV: 'test' as 'test' | 'development' | 'production',
  LOG_PROMPT_ASSEMBLY: false,
}));

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: () => mockConfig,
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

import { detectNameCollision, logDetailedPromptAssembly } from './PromptLogger.js';
import type { PromptAssemblyLogOptions } from './PromptLogger.js';

describe('PromptLogger', () => {
  beforeEach(() => {
    mockConfig.NODE_ENV = 'test';
    mockConfig.LOG_PROMPT_ASSEMBLY = false;
    mockLogger.debug.mockClear();
  });

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

  describe('logDetailedPromptAssembly', () => {
    const opts: PromptAssemblyLogOptions = {
      personality: { id: 'personality-1', name: 'Lilith' },
      persona: 'persona text',
      protocol: 'protocol text',
      context: { userId: 'user-1' },
      historyLength: 3,
      fullSystemPrompt: 'assembled system prompt',
    };

    it('dumps the assembly when development is paired with the explicit flag', () => {
      mockConfig.NODE_ENV = 'development';
      mockConfig.LOG_PROMPT_ASSEMBLY = true;

      logDetailedPromptAssembly(opts);

      expect(mockLogger.debug).toHaveBeenCalled();
      const fields = mockLogger.debug.mock.calls[0][0] as Record<string, unknown>;
      expect(fields).toHaveProperty('personalityName', 'Lilith');
    });

    it('stays silent in development when the flag is off', () => {
      mockConfig.NODE_ENV = 'development';
      mockConfig.LOG_PROMPT_ASSEMBLY = false;

      logDetailedPromptAssembly(opts);

      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('stays silent outside development even when the flag is on', () => {
      mockConfig.NODE_ENV = 'production';
      mockConfig.LOG_PROMPT_ASSEMBLY = true;

      logDetailedPromptAssembly(opts);

      expect(mockLogger.debug).not.toHaveBeenCalled();
    });
  });
});
