/**
 * Tests for aliasResolver utility
 */

// Mock dependencies before imports
jest.mock('../../../src/logger');
jest.mock('../../../src/application/bootstrap/ApplicationBootstrap');

const {
  resolvePersonality,
  resolveMultiplePersonalities,
  personalityExists,
  getFullName,
  getAliases,
  setPersonalityService,
} = require('../../../src/utils/aliasResolver');

const logger = require('../../../src/logger');
const { getApplicationBootstrap } = require('../../../src/application/bootstrap/ApplicationBootstrap');

describe('aliasResolver', () => {
  let mockPersonalityApplicationService;
  let mockBootstrap;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup personality service mock
    mockPersonalityApplicationService = {
      getPersonality: jest.fn(),
    };

    // Setup bootstrap mock
    mockBootstrap = {
      getPersonalityApplicationService: jest.fn().mockReturnValue(mockPersonalityApplicationService),
      initialized: true,
    };
    getApplicationBootstrap.mockReturnValue(mockBootstrap);

    // Set the personality service directly to avoid lazy loading in tests
    setPersonalityService(mockPersonalityApplicationService);
  });

  describe('resolvePersonality', () => {
    const mockPersonality = {
      profile: {
        name: 'Test Personality',
      },
      name: 'Test Personality', // Fallback for compatibility
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

    it('should resolve personality via personality service', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(mockPersonality);

      const result = await resolvePersonality('test');

      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('test');
      expect(result).toBe(mockPersonality);
      expect(logger.debug).toHaveBeenCalledWith('[AliasResolver] Resolving personality for: "test"');
      expect(logger.debug).toHaveBeenCalledWith('[AliasResolver] Found personality: Test Personality');
    });

    it('should trim input before resolving', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(mockPersonality);

      const result = await resolvePersonality('  test  ');

      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('test');
      expect(result).toBe(mockPersonality);
    });

    it('should return null when personality not found', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);

      const result = await resolvePersonality('unknown');

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith('[AliasResolver] Resolving personality for: "unknown"');
      expect(logger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Found personality'));
    });

    it('should handle errors gracefully', async () => {
      mockPersonalityApplicationService.getPersonality.mockImplementation(() => {
        throw new Error('Service error');
      });

      // The new implementation catches errors and returns null
      const result = await resolvePersonality('test');
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('[AliasResolver] Error resolving personality:', 'Service error');
    });
  });

  describe('resolveMultiplePersonalities', () => {
    const mockPersonality1 = { fullName: 'Personality 1' };
    const mockPersonality2 = { fullName: 'Personality 2' };

    it('should resolve multiple personalities', async () => {
      mockPersonalityApplicationService.getPersonality
        .mockResolvedValueOnce(mockPersonality1)
        .mockResolvedValueOnce(mockPersonality2)
        .mockResolvedValueOnce(null);

      const result = await resolveMultiplePersonalities(['name1', 'name2', 'unknown']);

      expect(result).toEqual([mockPersonality1, mockPersonality2]);
      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledTimes(3);
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
      expect(mockPersonalityApplicationService.getPersonality).not.toHaveBeenCalled();
    });

    it('should filter out invalid inputs within array', async () => {
      mockPersonalityApplicationService.getPersonality
        .mockResolvedValueOnce(mockPersonality1)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await resolveMultiplePersonalities(['valid', null, '']);

      expect(result).toEqual([mockPersonality1]);
    });

    it('should handle resolution errors gracefully', async () => {
      mockPersonalityApplicationService.getPersonality
        .mockResolvedValueOnce(mockPersonality1)
        .mockImplementationOnce(() => { throw new Error('Resolution error'); })
        .mockResolvedValueOnce(mockPersonality2);

      // The new implementation catches errors and continues with other resolutions
      const result = await resolveMultiplePersonalities(['name1', 'error', 'name2']);
      expect(result).toEqual([mockPersonality1, mockPersonality2]); // Both successful resolutions
      expect(logger.error).toHaveBeenCalledWith('[AliasResolver] Error resolving personality:', 'Resolution error');
    });
  });

  describe('personalityExists', () => {

    it('should return true when personality exists', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({ fullName: 'Test' });

      const result = await personalityExists('test');

      expect(result).toBe(true);
    });

    it('should return false when personality does not exist', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);

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

    it('should return full name when personality exists', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        profile: {
          name: 'Test Personality Full Name',
        },
        name: 'Test Personality Full Name', // Fallback
      });

      const result = await getFullName('test');

      expect(result).toBe('Test Personality Full Name');
    });

    it('should return null when personality not found', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);

      const result = await getFullName('unknown');

      expect(result).toBeNull();
    });

    it('should return null for invalid input', async () => {
      expect(await getFullName(null)).toBeNull();
      expect(await getFullName('')).toBeNull();
    });
  });

  describe('getAliases', () => {

    it('should return aliases when personality exists', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'Test',
        aliases: ['alias1', 'alias2', 'alias3'],
      });

      const result = await getAliases('test');

      expect(result).toEqual(['alias1', 'alias2', 'alias3']);
    });

    it('should return empty array when personality has no aliases', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'Test',
        // No aliases property
      });

      const result = await getAliases('test');

      expect(result).toEqual([]);
    });

    it('should return empty array when personality not found', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);

      const result = await getAliases('unknown');

      expect(result).toEqual([]);
    });

    it('should return empty array for invalid input', async () => {
      expect(await getAliases(null)).toEqual([]);
      expect(await getAliases('')).toEqual([]);
    });

    it('should handle null aliases property', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue({
        fullName: 'Test',
        aliases: null,
      });

      const result = await getAliases('test');

      expect(result).toEqual([]);
    });
  });

  describe('integration with personality service', () => {
    it('should use the personality service consistently', async () => {
      const mockPersonality = { fullName: 'Test Personality' };
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(mockPersonality);

      const result = await resolvePersonality('test');
      
      // Service is already set via setPersonalityService, no need to call getApplicationBootstrap
      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('test');
      expect(result).toBe(mockPersonality);
    });

    it('should handle service returning null', async () => {
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(null);

      const result = await resolvePersonality('nonexistent');
      
      expect(result).toBeNull();
      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('nonexistent');
    });

    it('should use lazy loading when service not set', async () => {
      // Reset the service to null to test lazy loading
      setPersonalityService(null);
      
      const mockPersonality = { fullName: 'Lazy Loaded' };
      mockPersonalityApplicationService.getPersonality.mockResolvedValue(mockPersonality);

      const result = await resolvePersonality('lazy');
      
      expect(getApplicationBootstrap).toHaveBeenCalled();
      expect(mockBootstrap.getPersonalityApplicationService).toHaveBeenCalled();
      expect(mockPersonalityApplicationService.getPersonality).toHaveBeenCalledWith('lazy');
      expect(result).toBe(mockPersonality);
    });

    it('should handle bootstrap not initialized during lazy loading', async () => {
      // Reset the service and make bootstrap not initialized
      setPersonalityService(null);
      mockBootstrap.initialized = false;

      const result = await resolvePersonality('notready');
      
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith('[AliasResolver] Personality service not available');
    });
  });
});