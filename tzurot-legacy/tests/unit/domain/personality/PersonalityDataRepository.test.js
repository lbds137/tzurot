const {
  PersonalityDataRepository,
} = require('../../../../src/domain/personality/PersonalityDataRepository');
const {
  ExtendedPersonalityProfile,
} = require('../../../../src/domain/personality/ExtendedPersonalityProfile');
const path = require('path');

// Mock fs and logger
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
    access: jest.fn(),
  },
}));
jest.mock('../../../../src/logger');

const fs = require('fs').promises;

describe('PersonalityDataRepository', () => {
  let repository;
  let mockDataDir;
  let mockBackupDir;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDataDir = '/mock/data/ddd_personality_data';
    mockBackupDir = '/mock/data/personalities';

    repository = new PersonalityDataRepository(mockDataDir);
    repository.backupDir = mockBackupDir;
  });

  describe('getExtendedProfile', () => {
    it('should return cached profile if available', async () => {
      const mockProfile = new ExtendedPersonalityProfile({
        name: 'test-personality',
        mode: 'local',
      });

      repository.cache.set('test-personality', mockProfile);

      const result = await repository.getExtendedProfile('test-personality');

      expect(result).toBe(mockProfile);
      expect(fs.readFile).not.toHaveBeenCalled();
    });

    it('should load migrated data if available', async () => {
      const mockMigratedData = {
        mode: 'local',
        name: 'test-personality',
        displayName: 'Test Personality',
        userPrompt: 'I am a test personality',
      };

      fs.readFile.mockResolvedValueOnce(JSON.stringify(mockMigratedData));

      const result = await repository.getExtendedProfile('test-personality');

      expect(result).toBeInstanceOf(ExtendedPersonalityProfile);
      expect(result.name).toBe('test-personality');
      expect(result.userPrompt).toBe('I am a test personality');
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(mockDataDir, 'test-personality', 'profile.json'),
        'utf8'
      );
    });

    it('should auto-migrate from backup data when no migrated data exists', async () => {
      // First read fails (no migrated data)
      fs.readFile.mockRejectedValueOnce(new Error('ENOENT'));

      // Check if backup dir exists
      fs.access.mockResolvedValueOnce();

      // Read backup files
      const mockBackupMain = {
        name: 'test-personality',
        user_prompt: 'I am a test personality',
        voice_id: 'test-voice',
      };

      const mockBackupMemories = [
        { content: 'Memory 1', created_at: 123456 },
        { content: 'Memory 2', created_at: 123457 },
      ];

      const mockBackupChatHistory = {
        messages: [
          { ts: 123456, message: 'Hello', reply: 'Hi there' },
          { ts: 123457, message: 'How are you?', reply: 'I am fine' },
        ],
      };

      // Mock reading backup files
      fs.readFile
        .mockResolvedValueOnce(JSON.stringify(mockBackupMain)) // main profile
        .mockResolvedValueOnce(JSON.stringify(mockBackupMemories)) // memories
        .mockRejectedValueOnce(new Error('ENOENT')) // no training
        .mockRejectedValueOnce(new Error('ENOENT')) // no user personalization
        .mockResolvedValueOnce(JSON.stringify(mockBackupChatHistory)); // chat history

      // Mock saving migrated data
      fs.mkdir.mockResolvedValueOnce();
      fs.writeFile.mockResolvedValueOnce();

      const result = await repository.getExtendedProfile('test-personality');

      expect(result).toBeInstanceOf(ExtendedPersonalityProfile);
      expect(result.name).toBe('test-personality');
      expect(result.voiceConfig).toEqual({
        model: 'eleven_multilingual_v2',
        id: 'test-voice',
        file: null,
        frequency: 1,
        stability: 1,
        similarity: 0.75,
        style: 0,
        transcriptionEnabled: true,
      });

      // Verify migration was saved
      expect(fs.mkdir).toHaveBeenCalledWith(path.join(mockDataDir, 'test-personality'), {
        recursive: true,
      });
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should return null when no data exists', async () => {
      fs.readFile.mockRejectedValue(new Error('ENOENT'));
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const result = await repository.getExtendedProfile('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('hasExtendedData', () => {
    it('should return true if migrated data exists', async () => {
      fs.access.mockResolvedValueOnce();

      const result = await repository.hasExtendedData('test-personality');

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(
        path.join(mockDataDir, 'test-personality', 'profile.json')
      );
    });

    it('should return true if backup data exists', async () => {
      fs.access
        .mockRejectedValueOnce(new Error('ENOENT')) // No migrated data
        .mockResolvedValueOnce(); // Backup exists

      const result = await repository.hasExtendedData('test-personality');

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(path.join(mockBackupDir, 'test-personality'));
    });

    it('should return false if no data exists', async () => {
      fs.access.mockRejectedValue(new Error('ENOENT'));

      const result = await repository.hasExtendedData('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('getChatHistory', () => {
    it('should return chat history with filtering options', async () => {
      const mockProfile = new ExtendedPersonalityProfile({
        name: 'test-personality',
        mode: 'local',
      });

      repository.cache.set('test-personality', mockProfile);

      const mockChatData = {
        messages: [
          { ts: 100, user_id: 'user1', message: 'Hello' },
          { ts: 200, user_id: 'user2', message: 'Hi' },
          { ts: 300, user_id: 'user1', message: 'How are you?' },
          { ts: 400, user_id: 'user1', message: 'Good' },
        ],
      };

      fs.readFile.mockResolvedValueOnce(JSON.stringify(mockChatData));

      const result = await repository.getChatHistory('test-personality', {
        userId: 'user1',
        beforeTimestamp: 350,
        limit: 2,
      });

      expect(result).toHaveLength(2);
      expect(result[0].ts).toBe(300);
      expect(result[1].ts).toBe(100);
    });
  });

  describe('clearCache', () => {
    it('should clear cache for specific personality', () => {
      repository.cache.set('personality1', {});
      repository.cache.set('personality2', {});

      repository.clearCache('personality1');

      expect(repository.cache.has('personality1')).toBe(false);
      expect(repository.cache.has('personality2')).toBe(true);
    });

    it('should clear entire cache when no personality specified', () => {
      repository.cache.set('personality1', {});
      repository.cache.set('personality2', {});

      repository.clearCache();

      expect(repository.cache.size).toBe(0);
    });
  });
});
