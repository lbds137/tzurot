import { describe, it, expect, vi } from 'vitest';

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: () => ({ NODE_ENV: 'test' }),
  };
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
  });
});
