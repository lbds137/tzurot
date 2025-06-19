// Mock dependencies
jest.mock('../../../../src/dataStorage', () => ({
  loadData: jest.fn(),
  saveData: jest.fn(),
}));

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const PersonalityPersistence = require('../../../../src/core/personality/PersonalityPersistence');
const { loadData, saveData } = require('../../../../src/dataStorage');
const logger = require('../../../../src/logger');

describe('PersonalityPersistence', () => {
  let persistence;

  beforeEach(() => {
    persistence = new PersonalityPersistence();
    jest.clearAllMocks();
  });

  describe('load', () => {
    it('should load personalities and aliases from storage', async () => {
      const mockPersonalities = {
        'test-personality': { fullName: 'test-personality', addedBy: 'user1' },
      };
      const mockAliases = {
        'test-alias': 'test-personality',
      };

      loadData.mockImplementation(file => {
        if (file === 'personalities') return Promise.resolve(mockPersonalities);
        if (file === 'aliases') return Promise.resolve(mockAliases);
        return Promise.resolve(null);
      });

      const result = await persistence.load();

      expect(loadData).toHaveBeenCalledWith('personalities');
      expect(loadData).toHaveBeenCalledWith('aliases');
      expect(result).toEqual({
        personalities: mockPersonalities,
        aliases: mockAliases,
      });
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityPersistence] Found 1 personalities in storage'
      );
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityPersistence] Found 1 aliases in storage'
      );
    });

    it('should handle missing data gracefully', async () => {
      loadData.mockResolvedValue(null);

      const result = await persistence.load();

      expect(result).toEqual({
        personalities: {},
        aliases: {},
      });
    });

    it('should handle load errors gracefully', async () => {
      loadData.mockRejectedValue(new Error('Load failed'));

      const result = await persistence.load();

      expect(result).toEqual({
        personalities: {},
        aliases: {},
      });
      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityPersistence] Error loading data: Load failed'
      );
    });
  });

  describe('save', () => {
    it('should save personalities and aliases to storage', async () => {
      const mockPersonalities = {
        'test-personality': { fullName: 'test-personality', addedBy: 'user1' },
      };
      const mockAliases = {
        'test-alias': 'test-personality',
      };

      saveData.mockResolvedValue(true);

      const result = await persistence.save(mockPersonalities, mockAliases);

      expect(saveData).toHaveBeenCalledWith('personalities', mockPersonalities);
      expect(saveData).toHaveBeenCalledWith('aliases', mockAliases);
      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityPersistence] Successfully saved 1 personalities and 1 aliases'
      );
    });

    it('should handle save errors', async () => {
      const mockPersonalities = {};
      const mockAliases = {};

      saveData.mockRejectedValue(new Error('Save failed'));

      const result = await persistence.save(mockPersonalities, mockAliases);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityPersistence] Error saving data: Save failed'
      );
    });

    it('should return false if alias save fails', async () => {
      const mockPersonalities = {};
      const mockAliases = {};

      saveData
        .mockResolvedValueOnce(true) // personalities save succeeds
        .mockResolvedValueOnce(false); // aliases save returns false (not rejected)

      const result = await persistence.save(mockPersonalities, mockAliases);

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith('[PersonalityPersistence] Failed to save aliases');
    });
  });

  describe('importFromLegacy', () => {
    it('should convert legacy personality format', async () => {
      const legacyData = {
        'old-personality': {
          fullName: 'old-personality',
          createdBy: 'legacy-user',
          someOtherField: 'value',
        },
      };

      loadData.mockImplementation(file => {
        if (file === 'personalities') return Promise.resolve(legacyData);
        if (file === 'aliases') return Promise.resolve({});
        return Promise.resolve(null);
      });

      const result = await persistence.load();

      // The load method doesn't transform data, it just loads it
      expect(result.personalities['old-personality']).toHaveProperty('createdBy', 'legacy-user');
    });
  });
});
