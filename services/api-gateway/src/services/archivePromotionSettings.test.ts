import { describe, it, expect, vi, afterEach } from 'vitest';
import { SYSTEM_SETTINGS_REGISTRY } from '@tzurot/common-types/schemas/api/systemSettingsRegistry';
import {
  asBag,
  readBoolSetting,
  readSlugListSettingLenient,
  readSlugListSettingStrict,
  MalformedSettingsList,
} from './archivePromotionSettings.js';

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
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('asBag', () => {
  it('passes a plain object through', () => {
    expect(asBag({ archivePromotionEnabled: true })).toEqual({ archivePromotionEnabled: true });
  });

  it('gives {} for null', () => {
    expect(asBag(null)).toEqual({});
  });

  it('gives {} for undefined', () => {
    expect(asBag(undefined)).toEqual({});
  });

  it('gives {} for an array', () => {
    expect(asBag(['a', 'b'])).toEqual({});
  });

  it('gives {} for a primitive', () => {
    expect(asBag('not-an-object')).toEqual({});
  });
});

describe('readBoolSetting', () => {
  it('passes true through', () => {
    expect(readBoolSetting({ archivePromotionEnabled: true })).toBe(true);
  });

  it('passes false through', () => {
    expect(readBoolSetting({ archivePromotionEnabled: false })).toBe(false);
  });

  it('falls back to the registry default for a non-boolean value', () => {
    expect(readBoolSetting({ archivePromotionEnabled: 'yes' })).toBe(
      SYSTEM_SETTINGS_REGISTRY.archivePromotionEnabled.fallback
    );
  });

  it('falls back to the registry default for an absent key', () => {
    expect(readBoolSetting({})).toBe(SYSTEM_SETTINGS_REGISTRY.archivePromotionEnabled.fallback);
  });
});

describe('readSlugListSettingLenient', () => {
  it('returns a well-formed string array and logs no warn', () => {
    const result = readSlugListSettingLenient(
      { archiveSplitRenderPersonalities: ['a', 'b'] },
      'archiveSplitRenderPersonalities'
    );
    expect(result).toEqual(['a', 'b']);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns the registry fallback for an absent key and logs no warn', () => {
    const result = readSlugListSettingLenient({}, 'archiveSplitRenderPersonalities');
    expect(result).toEqual(SYSTEM_SETTINGS_REGISTRY.archiveSplitRenderPersonalities.fallback);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('returns the fallback and logs exactly one warn for a present-but-malformed value', () => {
    const result = readSlugListSettingLenient(
      { archiveSplitRenderPersonalities: ['ok', 42] },
      'archiveSplitRenderPersonalities'
    );
    expect(result).toEqual(SYSTEM_SETTINGS_REGISTRY.archiveSplitRenderPersonalities.fallback);
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { key: 'archiveSplitRenderPersonalities' },
      expect.any(String)
    );
  });

  it('treats a stored null as malformed and warns', () => {
    const result = readSlugListSettingLenient(
      { archiveSplitRenderPersonalities: null },
      'archiveSplitRenderPersonalities'
    );
    expect(result).toEqual(SYSTEM_SETTINGS_REGISTRY.archiveSplitRenderPersonalities.fallback);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { key: 'archiveSplitRenderPersonalities' },
      expect.any(String)
    );
  });
});

describe('readSlugListSettingStrict', () => {
  it('returns a well-formed string array', () => {
    const result = readSlugListSettingStrict(
      { recentDaysDigestPersonalities: ['a', 'b'] },
      'recentDaysDigestPersonalities'
    );
    expect(result).toEqual(['a', 'b']);
  });

  it('returns the registry fallback for an absent key', () => {
    const result = readSlugListSettingStrict({}, 'recentDaysDigestPersonalities');
    expect(result).toEqual(SYSTEM_SETTINGS_REGISTRY.recentDaysDigestPersonalities.fallback);
  });

  it('throws MalformedSettingsList for a present-but-malformed value', () => {
    expect(() =>
      readSlugListSettingStrict(
        { recentDaysDigestPersonalities: ['ok', 42] },
        'recentDaysDigestPersonalities'
      )
    ).toThrow(MalformedSettingsList);
  });

  it('the thrown error carries the key that was passed in', () => {
    let thrown: unknown;
    try {
      readSlugListSettingStrict(
        { recentDaysDigestPersonalities: ['ok', 42] },
        'recentDaysDigestPersonalities'
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MalformedSettingsList);
    expect((thrown as MalformedSettingsList).key).toBe('recentDaysDigestPersonalities');
  });

  it('throws for a stored null', () => {
    expect(() =>
      readSlugListSettingStrict(
        { recentDaysDigestPersonalities: null },
        'recentDaysDigestPersonalities'
      )
    ).toThrow(MalformedSettingsList);
  });
});
