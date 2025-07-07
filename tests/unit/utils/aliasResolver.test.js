/**
 * Tests for aliasResolver utility
 */

// Mock dependencies before imports
jest.mock('../../../src/logger');
jest.mock('../../../src/application/services/FeatureFlags');
jest.mock('../../../src/application/routers/PersonalityRouter');
jest.mock('../../../src/core/personality');

const {
  resolvePersonality,
  resolveMultiplePersonalities,
  personalityExists,
  getFullName,
  getAliases,
} = require('../../../src/utils/aliasResolver');

const logger = require('../../../src/logger');
const { getFeatureFlags } = require('../../../src/application/services/FeatureFlags');
const { getPersonalityRouter } = require('../../../src/application/routers/PersonalityRouter');
const {
  getPersonality: getLegacyPersonality,
  getPersonalityByAlias: getLegacyPersonalityByAlias,
} = require('../../../src/core/personality');

describe('aliasResolver', () => {
  let mockFeatureFlags;
  let mockPersonalityRouter;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default mock setup
    mockFeatureFlags = {
      isEnabled: jest.fn().mockReturnValue(false),
    };
    getFeatureFlags.mockReturnValue(mockFeatureFlags);

    mockPersonalityRouter = {
      getPersonality: jest.fn(),
    };
    getPersonalityRouter.mockReturnValue(mockPersonalityRouter);

    // Setup legacy mocks
    getLegacyPersonality.mockResolvedValue(null);
    getLegacyPersonalityByAlias.mockResolvedValue(null);
  });

  describe('resolvePersonality', () => {
    const mockPersonality = {
      fullName: 'Test Personality',
      aliases: ['test', 'testy'],
    };

    it('should return null for invalid inputs', async () => {
      expect(await resolvePersonality(null)).toBeNull();
      expect(await resolvePersonality(undefined)).toBeNull();
      expect(await resolvePersonality('')).toBeNull();
      expect(await resolvePersonality('   ')).toBeNull();
      expect(await resolvePersonality(123)).toBeNull();
      expect(await resolvePersonality({})).toBeNull();
      expect(await resolvePersonality([])).toBeNull();
    });

    describe('with DDD system enabled', () => {
      beforeEach(() => {
        mockFeatureFlags.isEnabled.mockReturnValue(true);
      });

      it('should resolve personality via DDD system', async () => {
        mockPersonalityRouter.getPersonality.mockResolvedValue(mockPersonality);

        const result = await resolvePersonality('test');

        expect(mockFeatureFlags.isEnabled).toHaveBeenCalledWith('ddd.personality.read');
        expect(mockPersonalityRouter.getPersonality).toHaveBeenCalledWith('test');
        expect(result).toBe(mockPersonality);
        expect(logger.debug).toHaveBeenCalledWith('[AliasResolver] Resolving personality for: "test"');
        expect(logger.debug).toHaveBeenCalledWith('[AliasResolver] Found personality via DDD: Test Personality');
      });

      it('should trim input before resolving', async () => {
        mockPersonalityRouter.getPersonality.mockResolvedValue(mockPersonality);

        const result = await resolvePersonality('  test  ');

        expect(mockPersonalityRouter.getPersonality).toHaveBeenCalledWith('test');
        expect(result).toBe(mockPersonality);
      });

      it('should return null when personality not found in DDD', async () => {
        mockPersonalityRouter.getPersonality.mockResolvedValue(null);

        const result = await resolvePersonality('unknown');

        expect(result).toBeNull();
        expect(logger.debug).toHaveBeenCalledWith('[AliasResolver] Resolving personality for: "unknown"');
        expect(logger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Found personality'));
      });

      it('should not use legacy system when DDD is enabled', async () => {
        mockPersonalityRouter.getPersonality.mockResolvedValue(mockPersonality);

        await resolvePersonality('test');

        expect(getLegacyPersonality).not.toHaveBeenCalled();
        expect(getLegacyPersonalityByAlias).not.toHaveBeenCalled();
      });
    });

    describe('with legacy system', () => {
      beforeEach(() => {
        mockFeatureFlags.isEnabled.mockReturnValue(false);
      });

      it('should resolve personality by name first', async () => {
        getLegacyPersonality.mockResolvedValue(mockPersonality);

        const result = await resolvePersonality('test');

        expect(getLegacyPersonality).toHaveBeenCalledWith('test');
        expect(getLegacyPersonalityByAlias).not.toHaveBeenCalled();
        expect(result).toBe(mockPersonality);
        expect(logger.debug).toHaveBeenCalledWith('[AliasResolver] Found personality via legacy: Test Personality');
      });

      it('should fallback to alias lookup if name not found', async () => {
        getLegacyPersonality.mockResolvedValue(null);
        getLegacyPersonalityByAlias.mockResolvedValue(mockPersonality);

        const result = await resolvePersonality('testy');

        expect(getLegacyPersonality).toHaveBeenCalledWith('testy');
        expect(getLegacyPersonalityByAlias).toHaveBeenCalledWith('testy');
        expect(result).toBe(mockPersonality);
        expect(logger.debug).toHaveBeenCalledWith('[AliasResolver] Found personality via legacy: Test Personality');
      });

      it('should return null when not found in either name or alias', async () => {
        getLegacyPersonality.mockResolvedValue(null);
        getLegacyPersonalityByAlias.mockResolvedValue(null);

        const result = await resolvePersonality('unknown');

        expect(result).toBeNull();
        expect(getLegacyPersonality).toHaveBeenCalledWith('unknown');
        expect(getLegacyPersonalityByAlias).toHaveBeenCalledWith('unknown');
      });

      it('should trim input for legacy system', async () => {
        getLegacyPersonality.mockResolvedValue(mockPersonality);

        await resolvePersonality('  test  ');

        expect(getLegacyPersonality).toHaveBeenCalledWith('test');
      });
    });

    it('should handle errors gracefully', async () => {
      mockFeatureFlags.isEnabled.mockImplementation(() => {
        throw new Error('Feature flag error');
      });

      await expect(resolvePersonality('test')).rejects.toThrow('Feature flag error');
    });
  });

  describe('resolveMultiplePersonalities', () => {
    const mockPersonality1 = { fullName: 'Personality 1' };
    const mockPersonality2 = { fullName: 'Personality 2' };

    beforeEach(() => {
      mockFeatureFlags.isEnabled.mockReturnValue(true);
    });

    it('should resolve multiple personalities', async () => {
      mockPersonalityRouter.getPersonality
        .mockResolvedValueOnce(mockPersonality1)
        .mockResolvedValueOnce(mockPersonality2)
        .mockResolvedValueOnce(null);

      const result = await resolveMultiplePersonalities(['name1', 'name2', 'unknown']);

      expect(result).toEqual([mockPersonality1, mockPersonality2]);
      expect(mockPersonalityRouter.getPersonality).toHaveBeenCalledTimes(3);
    });

    it('should return empty array for non-array input', async () => {
      expect(await resolveMultiplePersonalities(null)).toEqual([]);
      expect(await resolveMultiplePersonalities(undefined)).toEqual([]);
      expect(await resolveMultiplePersonalities('string')).toEqual([]);
      expect(await resolveMultiplePersonalities(123)).toEqual([]);
      expect(await resolveMultiplePersonalities({})).toEqual([]);
    });

    it('should handle empty array', async () => {
      const result = await resolveMultiplePersonalities([]);

      expect(result).toEqual([]);
      expect(mockPersonalityRouter.getPersonality).not.toHaveBeenCalled();
    });

    it('should filter out invalid inputs within array', async () => {
      mockPersonalityRouter.getPersonality
        .mockResolvedValueOnce(mockPersonality1)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await resolveMultiplePersonalities(['valid', null, '']);

      expect(result).toEqual([mockPersonality1]);
    });

    it('should handle resolution errors gracefully', async () => {
      mockPersonalityRouter.getPersonality
        .mockResolvedValueOnce(mockPersonality1)
        .mockRejectedValueOnce(new Error('Resolution error'))
        .mockResolvedValueOnce(mockPersonality2);

      await expect(resolveMultiplePersonalities(['name1', 'error', 'name2'])).rejects.toThrow('Resolution error');
    });
  });

  describe('personalityExists', () => {
    beforeEach(() => {
      mockFeatureFlags.isEnabled.mockReturnValue(true);
    });

    it('should return true when personality exists', async () => {
      mockPersonalityRouter.getPersonality.mockResolvedValue({ fullName: 'Test' });

      const result = await personalityExists('test');

      expect(result).toBe(true);
    });

    it('should return false when personality does not exist', async () => {
      mockPersonalityRouter.getPersonality.mockResolvedValue(null);

      const result = await personalityExists('unknown');

      expect(result).toBe(false);
    });

    it('should return false for invalid input', async () => {
      expect(await personalityExists(null)).toBe(false);
      expect(await personalityExists('')).toBe(false);
      expect(await personalityExists('   ')).toBe(false);
    });
  });

  describe('getFullName', () => {
    beforeEach(() => {
      mockFeatureFlags.isEnabled.mockReturnValue(true);
    });

    it('should return full name when personality exists', async () => {
      mockPersonalityRouter.getPersonality.mockResolvedValue({
        fullName: 'Test Personality Full Name',
      });

      const result = await getFullName('test');

      expect(result).toBe('Test Personality Full Name');
    });

    it('should return null when personality not found', async () => {
      mockPersonalityRouter.getPersonality.mockResolvedValue(null);

      const result = await getFullName('unknown');

      expect(result).toBeNull();
    });

    it('should return null for invalid input', async () => {
      expect(await getFullName(null)).toBeNull();
      expect(await getFullName('')).toBeNull();
    });
  });

  describe('getAliases', () => {
    beforeEach(() => {
      mockFeatureFlags.isEnabled.mockReturnValue(true);
    });

    it('should return aliases when personality exists', async () => {
      mockPersonalityRouter.getPersonality.mockResolvedValue({
        fullName: 'Test',
        aliases: ['alias1', 'alias2', 'alias3'],
      });

      const result = await getAliases('test');

      expect(result).toEqual(['alias1', 'alias2', 'alias3']);
    });

    it('should return empty array when personality has no aliases', async () => {
      mockPersonalityRouter.getPersonality.mockResolvedValue({
        fullName: 'Test',
        // No aliases property
      });

      const result = await getAliases('test');

      expect(result).toEqual([]);
    });

    it('should return empty array when personality not found', async () => {
      mockPersonalityRouter.getPersonality.mockResolvedValue(null);

      const result = await getAliases('unknown');

      expect(result).toEqual([]);
    });

    it('should return empty array for invalid input', async () => {
      expect(await getAliases(null)).toEqual([]);
      expect(await getAliases('')).toEqual([]);
    });

    it('should handle null aliases property', async () => {
      mockPersonalityRouter.getPersonality.mockResolvedValue({
        fullName: 'Test',
        aliases: null,
      });

      const result = await getAliases('test');

      expect(result).toEqual([]);
    });
  });

  describe('feature flag transitions', () => {
    it('should switch between DDD and legacy based on feature flag', async () => {
      const mockPersonality = { fullName: 'Test' };

      // Start with DDD disabled
      mockFeatureFlags.isEnabled.mockReturnValue(false);
      getLegacyPersonality.mockResolvedValue(mockPersonality);

      let result = await resolvePersonality('test');
      expect(getLegacyPersonality).toHaveBeenCalledWith('test');
      expect(mockPersonalityRouter.getPersonality).not.toHaveBeenCalled();
      expect(result).toBe(mockPersonality);

      // Clear mocks
      jest.clearAllMocks();

      // Enable DDD
      mockFeatureFlags.isEnabled.mockReturnValue(true);
      mockPersonalityRouter.getPersonality.mockResolvedValue(mockPersonality);

      result = await resolvePersonality('test');
      expect(mockPersonalityRouter.getPersonality).toHaveBeenCalledWith('test');
      expect(getLegacyPersonality).not.toHaveBeenCalled();
      expect(result).toBe(mockPersonality);
    });
  });
});