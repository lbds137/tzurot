/**
 * Tests for ExtendedContextSettingsResolver
 *
 * @see docs/planning/EXTENDED_CONTEXT_IMPROVEMENTS.md for resolution rules
 */

import { describe, it, expect, vi } from 'vitest';
import {
  resolveExtendedContextEnabled,
  resolveNumericLimit,
  resolveMaxAge,
  resolveExtendedContextSettings,
  toLevelSettings,
  toGlobalSettings,
  EXTENDED_CONTEXT_LIMITS,
  type GlobalSettings,
} from './ExtendedContextSettingsResolver.js';
import type { LevelSettings } from '../../schemas/api/adminSettings.js';

// Mock the logger
vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ExtendedContextSettingsResolver', () => {
  // Default global settings for tests
  const defaultGlobal: GlobalSettings = {
    extendedContextDefault: true,
    extendedContextMaxMessages: 20,
    extendedContextMaxAge: null, // disabled
    extendedContextMaxImages: 10,
  };

  describe('resolveExtendedContextEnabled', () => {
    describe('channel explicit OFF', () => {
      it('should return false when channel is OFF, regardless of personality', () => {
        expect(resolveExtendedContextEnabled(false, true, true)).toEqual({
          value: false,
          source: 'channel',
        });
        expect(resolveExtendedContextEnabled(false, false, true)).toEqual({
          value: false,
          source: 'channel',
        });
        expect(resolveExtendedContextEnabled(false, null, true)).toEqual({
          value: false,
          source: 'channel',
        });
      });

      it('should return false when channel is OFF, even if global is true', () => {
        expect(resolveExtendedContextEnabled(false, null, true)).toEqual({
          value: false,
          source: 'channel',
        });
      });
    });

    describe('channel explicit ON', () => {
      it('should return true when channel is ON and personality agrees', () => {
        expect(resolveExtendedContextEnabled(true, true, false)).toEqual({
          value: true,
          source: 'channel',
        });
        expect(resolveExtendedContextEnabled(true, null, false)).toEqual({
          value: true,
          source: 'channel',
        });
      });

      it('should allow personality to opt-out even when channel is ON', () => {
        expect(resolveExtendedContextEnabled(true, false, true)).toEqual({
          value: false,
          source: 'personality',
        });
      });
    });

    describe('channel AUTO (null)', () => {
      it('should use personality preference when channel is AUTO', () => {
        expect(resolveExtendedContextEnabled(null, true, false)).toEqual({
          value: true,
          source: 'personality',
        });
        expect(resolveExtendedContextEnabled(null, false, true)).toEqual({
          value: false,
          source: 'personality',
        });
      });

      it('should use global default when both are AUTO', () => {
        expect(resolveExtendedContextEnabled(null, null, true)).toEqual({
          value: true,
          source: 'global',
        });
        expect(resolveExtendedContextEnabled(null, null, false)).toEqual({
          value: false,
          source: 'global',
        });
      });
    });
  });

  describe('resolveNumericLimit', () => {
    const hardCap = EXTENDED_CONTEXT_LIMITS.MAX_MESSAGES_HARD_CAP;

    describe('basic resolution', () => {
      it('should use global default when no overrides', () => {
        expect(resolveNumericLimit(null, null, 20, hardCap)).toEqual({
          value: 20,
          source: 'global',
        });
      });

      it('should use channel value when set', () => {
        expect(resolveNumericLimit(30, null, 20, hardCap)).toEqual({
          value: 30,
          source: 'channel',
        });
      });

      it('should use personality value when channel is null', () => {
        expect(resolveNumericLimit(null, 15, 20, hardCap)).toEqual({
          value: 15,
          source: 'personality',
        });
      });
    });

    describe('most restrictive wins', () => {
      it('should allow personality to go lower than channel', () => {
        expect(resolveNumericLimit(50, 30, 20, hardCap)).toEqual({
          value: 30,
          source: 'personality',
        });
      });

      it('should NOT allow personality to exceed channel cap', () => {
        expect(resolveNumericLimit(30, 50, 20, hardCap)).toEqual({
          value: 30,
          source: 'channel',
        });
      });
    });

    describe('hard cap enforcement', () => {
      it('should enforce hard cap on global values', () => {
        expect(resolveNumericLimit(null, null, 200, hardCap)).toEqual({
          value: 100,
          source: 'global',
        });
      });

      it('should enforce hard cap on channel values', () => {
        expect(resolveNumericLimit(150, null, 20, hardCap)).toEqual({
          value: 100,
          source: 'channel',
        });
      });

      it('should enforce hard cap on personality values', () => {
        expect(resolveNumericLimit(null, 150, 20, hardCap)).toEqual({
          value: 100,
          source: 'personality',
        });
      });
    });
  });

  describe('resolveMaxAge', () => {
    describe('global disabled (null)', () => {
      it('should stay disabled when no overrides', () => {
        expect(resolveMaxAge(null, null, null)).toEqual({
          value: null,
          source: 'global',
        });
      });

      it('should allow channel to enable', () => {
        expect(resolveMaxAge(3600, null, null)).toEqual({
          value: 3600,
          source: 'channel',
        });
      });

      it('should allow personality to enable', () => {
        expect(resolveMaxAge(null, 1800, null)).toEqual({
          value: 1800,
          source: 'personality',
        });
      });

      it('should use most restrictive when both enable', () => {
        expect(resolveMaxAge(3600, 1800, null)).toEqual({
          value: 1800,
          source: 'personality',
        });
      });
    });

    describe('global enabled', () => {
      it('should use global when no overrides', () => {
        expect(resolveMaxAge(null, null, 7200)).toEqual({
          value: 7200,
          source: 'global',
        });
      });

      it('should allow channel to be more restrictive', () => {
        expect(resolveMaxAge(3600, null, 7200)).toEqual({
          value: 3600,
          source: 'channel',
        });
      });

      it('should allow personality to be more restrictive than channel', () => {
        expect(resolveMaxAge(3600, 1800, 7200)).toEqual({
          value: 1800,
          source: 'personality',
        });
      });

      it('should NOT allow personality to exceed channel cap', () => {
        expect(resolveMaxAge(1800, 3600, 7200)).toEqual({
          value: 1800,
          source: 'channel',
        });
      });
    });
  });

  describe('resolveExtendedContextSettings', () => {
    it('should resolve all settings with defaults', () => {
      const result = resolveExtendedContextSettings(defaultGlobal);

      expect(result).toEqual({
        enabled: true,
        maxMessages: 20,
        maxAge: null,
        maxImages: 10,
        sources: {
          enabled: 'global',
          maxMessages: 'global',
          maxAge: 'global',
          maxImages: 'global',
        },
      });
    });

    it('should handle channel overrides', () => {
      const channel: LevelSettings = {
        extendedContext: false,
        extendedContextMaxMessages: 50,
        extendedContextMaxAge: 3600,
        extendedContextMaxImages: 5,
      };

      const result = resolveExtendedContextSettings(defaultGlobal, channel);

      expect(result).toEqual({
        enabled: false,
        maxMessages: 50,
        maxAge: 3600,
        maxImages: 5,
        sources: {
          enabled: 'channel',
          maxMessages: 'channel',
          maxAge: 'channel',
          maxImages: 'channel',
        },
      });
    });

    it('should handle personality overrides within channel bounds', () => {
      const channel: LevelSettings = {
        extendedContext: true,
        extendedContextMaxMessages: 50,
        extendedContextMaxAge: null,
        extendedContextMaxImages: null,
      };
      const personality: LevelSettings = {
        extendedContext: null, // follow channel
        extendedContextMaxMessages: 30, // lower than channel
        extendedContextMaxAge: 1800, // personality enables
        extendedContextMaxImages: 3,
      };

      const result = resolveExtendedContextSettings(defaultGlobal, channel, personality);

      expect(result).toEqual({
        enabled: true,
        maxMessages: 30, // personality wins (lower)
        maxAge: 1800, // personality enabled
        maxImages: 3, // personality wins (lower than global)
        sources: {
          enabled: 'channel',
          maxMessages: 'personality',
          maxAge: 'personality',
          maxImages: 'personality',
        },
      });
    });

    it('should enforce hard caps', () => {
      const global: GlobalSettings = {
        extendedContextDefault: true,
        extendedContextMaxMessages: 200, // exceeds hard cap
        extendedContextMaxAge: null,
        extendedContextMaxImages: 50, // exceeds hard cap
      };

      const result = resolveExtendedContextSettings(global);

      expect(result.maxMessages).toBe(100); // hard cap
      expect(result.maxImages).toBe(20); // hard cap
    });

    it('should handle null channel and personality gracefully', () => {
      const result = resolveExtendedContextSettings(defaultGlobal, null, null);

      expect(result.sources.enabled).toBe('global');
      expect(result.sources.maxMessages).toBe('global');
    });
  });

  describe('toLevelSettings', () => {
    it('should convert database row to LevelSettings', () => {
      const row = {
        extendedContext: true,
        extendedContextMaxMessages: 50,
        extendedContextMaxAge: 3600,
        extendedContextMaxImages: 5,
      };

      expect(toLevelSettings(row)).toEqual({
        extendedContext: true,
        extendedContextMaxMessages: 50,
        extendedContextMaxAge: 3600,
        extendedContextMaxImages: 5,
      });
    });

    it('should handle undefined fields as null', () => {
      const row = {};

      expect(toLevelSettings(row)).toEqual({
        extendedContext: null,
        extendedContextMaxMessages: null,
        extendedContextMaxAge: null,
        extendedContextMaxImages: null,
      });
    });
  });

  describe('toGlobalSettings', () => {
    it('should convert AdminSettings row to GlobalSettings', () => {
      const row = {
        extendedContextDefault: true,
        extendedContextMaxMessages: 20,
        extendedContextMaxAge: null,
        extendedContextMaxImages: 10,
      };

      expect(toGlobalSettings(row)).toEqual({
        extendedContextDefault: true,
        extendedContextMaxMessages: 20,
        extendedContextMaxAge: null,
        extendedContextMaxImages: 10,
      });
    });
  });

  describe('real-world scenarios', () => {
    it('scenario: busy channel with strict limits', () => {
      // Server admin wants to limit AI context in #general
      const channel: LevelSettings = {
        extendedContext: true,
        extendedContextMaxMessages: 10, // strict limit
        extendedContextMaxAge: 1800, // 30 min max
        extendedContextMaxImages: 2,
      };
      // Verbose personality wants more context
      const personality: LevelSettings = {
        extendedContext: true,
        extendedContextMaxMessages: 100, // wants max
        extendedContextMaxAge: null, // no age limit
        extendedContextMaxImages: 10,
      };

      const result = resolveExtendedContextSettings(defaultGlobal, channel, personality);

      // Channel caps should win (most restrictive)
      expect(result.maxMessages).toBe(10);
      expect(result.sources.maxMessages).toBe('channel');
      expect(result.maxAge).toBe(1800);
      expect(result.maxImages).toBe(2);
    });

    it('scenario: privacy channel disables extended context', () => {
      // Server admin disables extended context for sensitive channel
      const channel: LevelSettings = {
        extendedContext: false, // admin disabled
        extendedContextMaxMessages: null,
        extendedContextMaxAge: null,
        extendedContextMaxImages: null,
      };
      // Personality wants it enabled
      const personality: LevelSettings = {
        extendedContext: true,
        extendedContextMaxMessages: 50,
        extendedContextMaxAge: null,
        extendedContextMaxImages: 5,
      };

      const result = resolveExtendedContextSettings(defaultGlobal, channel, personality);

      // Channel OFF beats everything
      expect(result.enabled).toBe(false);
      expect(result.sources.enabled).toBe('channel');
    });

    it('scenario: personality opts out in enabled channel', () => {
      // Channel allows extended context
      const channel: LevelSettings = {
        extendedContext: true,
        extendedContextMaxMessages: 50,
        extendedContextMaxAge: null,
        extendedContextMaxImages: 10,
      };
      // Personality prefers not to use it
      const personality: LevelSettings = {
        extendedContext: false, // opt-out
        extendedContextMaxMessages: null,
        extendedContextMaxAge: null,
        extendedContextMaxImages: null,
      };

      const result = resolveExtendedContextSettings(defaultGlobal, channel, personality);

      // Personality can opt-out even in enabled channel
      expect(result.enabled).toBe(false);
      expect(result.sources.enabled).toBe('personality');
    });
  });
});
