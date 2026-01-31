/**
 * Tests for PersonalityDataRepository infrastructure
 */

const {
  PersonalityDataRepository,
} = require('../../../../src/infrastructure/backup/PersonalityDataRepository');
const {
  PersonalityData,
  BackupMetadata,
} = require('../../../../src/domain/backup/PersonalityData');
const logger = require('../../../../src/logger');

// Mock logger
jest.mock('../../../../src/logger');

describe('PersonalityDataRepository', () => {
  let repository;
  let mockFs;
  let mockBackupDir;

  beforeEach(() => {
    jest.clearAllMocks();

    mockBackupDir = '/test/backup/dir';

    // Mock file system
    mockFs = {
      mkdir: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn(),
      writeFile: jest.fn().mockResolvedValue(undefined),
      access: jest.fn(),
    };

    repository = new PersonalityDataRepository({
      backupDir: mockBackupDir,
      fs: mockFs,
    });
  });

  describe('constructor', () => {
    it('should initialize with custom options', () => {
      expect(repository.backupDir).toBe(mockBackupDir);
      expect(repository.fs).toBe(mockFs);
    });

    it('should use defaults when no options provided', () => {
      const defaultRepo = new PersonalityDataRepository();
      expect(defaultRepo.backupDir).toContain('data/personalities');
    });
  });

  describe('load()', () => {
    beforeEach(() => {
      // Mock successful file reads with default empty data
      mockFs.readFile
        .mockResolvedValueOnce('{}') // metadata
        .mockRejectedValueOnce(new Error('ENOENT')) // profile (doesn't exist)
        .mockResolvedValueOnce('[]') // memories
        .mockResolvedValueOnce('[]') // knowledge
        .mockResolvedValueOnce('[]') // training
        .mockResolvedValueOnce('{}') // user personalization
        .mockResolvedValueOnce('{"messages": []}'); // chat history
    });

    it('should load personality data successfully', async () => {
      const personalityData = await repository.load('TestPersonality');

      expect(personalityData).toBeInstanceOf(PersonalityData);
      expect(personalityData.name).toBe('TestPersonality');
      expect(personalityData.metadata).toBeInstanceOf(BackupMetadata);
      expect(personalityData.memories).toEqual([]);
      expect(personalityData.knowledge).toEqual([]);
      expect(personalityData.training).toEqual([]);
      expect(personalityData.userPersonalization).toEqual({});
      expect(personalityData.chatHistory).toEqual([]);
    });

    it('should handle missing metadata file', async () => {
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

      const personalityData = await repository.load('TestPersonality');

      expect(personalityData.metadata).toBeInstanceOf(BackupMetadata);
      expect(personalityData.metadata.lastBackup).toBeNull();
    });

    it('should handle missing profile gracefully', async () => {
      const personalityData = await repository.load('TestPersonality');

      expect(personalityData.profile).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(
        '[PersonalityDataRepository] No existing profile for TestPersonality'
      );
    });

    it('should load existing data files', async () => {
      // Create a fresh repository instance to avoid beforeEach interference
      const freshRepository = new PersonalityDataRepository({
        backupDir: mockBackupDir,
        fs: {
          ...mockFs,
          readFile: jest.fn(),
        },
      });

      const metadata = { lastBackup: '2023-01-01T00:00:00.000Z', totalMemories: 2 };
      const profile = { id: 'test-id', name: 'TestPersonality' };
      const memories = [{ id: 'mem1', content: 'Memory 1' }];
      const knowledge = [{ id: 'know1', content: 'Knowledge 1' }];
      const training = [{ id: 'train1', input: 'Input 1' }];
      const userPersonalization = { preferences: { theme: 'dark' } };
      const chatHistory = { messages: [{ ts: 1609459200, content: 'Message 1' }] };

      freshRepository.fs.readFile
        .mockResolvedValueOnce(JSON.stringify(metadata))
        .mockResolvedValueOnce(JSON.stringify(profile))
        .mockResolvedValueOnce(JSON.stringify(memories))
        .mockResolvedValueOnce(JSON.stringify(knowledge))
        .mockResolvedValueOnce(JSON.stringify(training))
        .mockResolvedValueOnce(JSON.stringify(userPersonalization))
        .mockResolvedValueOnce(JSON.stringify(chatHistory));

      const personalityData = await freshRepository.load('TestPersonality');

      expect(personalityData.profile).toEqual(profile);
      expect(personalityData.memories).toEqual(memories);
      expect(personalityData.knowledge).toEqual(knowledge);
      expect(personalityData.training).toEqual(training);
      expect(personalityData.userPersonalization).toEqual(userPersonalization);
      expect(personalityData.chatHistory).toEqual(chatHistory.messages);
      expect(personalityData.metadata.totalMemories).toBe(2);
    });

    it('should handle corrupted JSON files', async () => {
      mockFs.readFile.mockResolvedValue('invalid json {');

      const personalityData = await repository.load('TestPersonality');

      expect(personalityData).toBeInstanceOf(PersonalityData);
      expect(personalityData.name).toBe('TestPersonality');
      // Should return default empty data for corrupted files
      expect(personalityData.memories).toEqual([]);
      expect(personalityData.knowledge).toEqual([]);
      expect(personalityData.training).toEqual([]);
      expect(personalityData.userPersonalization).toEqual({});
      expect(personalityData.chatHistory).toEqual([]);
    });
  });

  describe('save()', () => {
    let personalityData;

    beforeEach(() => {
      personalityData = new PersonalityData('TestPersonality', 'test-id');
      personalityData.profile = { id: 'test-id', name: 'TestPersonality' };
      personalityData.memories = [{ id: 'mem1', content: 'Memory 1' }];
      personalityData.knowledge = [{ id: 'know1', content: 'Knowledge 1' }];
      personalityData.training = [{ id: 'train1', input: 'Input 1' }];
      personalityData.userPersonalization = { preferences: { theme: 'dark' } };
      personalityData.chatHistory = [{ ts: 1609459200, content: 'Message 1' }];
      personalityData.metadata.lastBackup = '2023-01-01T00:00:00.000Z';
    });

    it('should save all personality data', async () => {
      await repository.save(personalityData);

      // Verify directory creation
      expect(mockFs.mkdir).toHaveBeenCalledWith('/test/backup/dir/TestPersonality', {
        recursive: true,
      });

      // Verify file writes
      expect(mockFs.writeFile).toHaveBeenCalledTimes(7); // metadata + 6 data files

      // Check metadata save
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/test/backup/dir/TestPersonality/.backup-metadata.json',
        expect.stringContaining('"lastBackup": "2023-01-01T00:00:00.000Z"')
      );

      // Check profile save
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/test/backup/dir/TestPersonality/TestPersonality.json',
        expect.stringContaining('"name": "TestPersonality"')
      );

      // Verify logger calls
      expect(logger.info).toHaveBeenCalledWith(
        '[PersonalityDataRepository] Saved data for TestPersonality'
      );
    });

    it('should skip empty data arrays', async () => {
      personalityData.memories = [];
      personalityData.knowledge = [];
      personalityData.training = [];
      personalityData.userPersonalization = {};
      personalityData.chatHistory = [];

      await repository.save(personalityData);

      // Should only save metadata and profile (2 files)
      expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
    });

    it('should handle missing profile', async () => {
      personalityData.profile = null;

      await repository.save(personalityData);

      // Should save all except profile
      expect(mockFs.writeFile).toHaveBeenCalledTimes(6);
    });

    it('should format chat history correctly', async () => {
      await repository.save(personalityData);

      const chatHistoryCall = mockFs.writeFile.mock.calls.find(call =>
        call[0].includes('_chat_history.json')
      );

      expect(chatHistoryCall).toBeDefined();
      const chatData = JSON.parse(chatHistoryCall[1]);

      expect(chatData).toEqual({
        shape_id: 'test-id',
        shape_name: 'TestPersonality',
        message_count: 1,
        date_range: {
          earliest: '2021-01-01T00:00:00.000Z',
          latest: '2021-01-01T00:00:00.000Z',
        },
        export_date: expect.any(String),
        messages: personalityData.chatHistory,
      });
    });

    it('should throw error for invalid input', async () => {
      const invalidData = { name: 'Test' }; // Not a PersonalityData instance

      await expect(repository.save(invalidData)).rejects.toThrow(
        'Invalid data: must be PersonalityData instance'
      );
    });

    it('should handle file write errors', async () => {
      const writeError = new Error('Disk full');
      mockFs.writeFile.mockRejectedValue(writeError);

      await expect(repository.save(personalityData)).rejects.toThrow('Disk full');

      expect(logger.error).toHaveBeenCalledWith(
        '[PersonalityDataRepository] Error saving TestPersonality: Disk full'
      );
    });
  });

  describe('exists()', () => {
    it('should return true if personality directory exists', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const exists = await repository.exists('TestPersonality');

      expect(exists).toBe(true);
      expect(mockFs.access).toHaveBeenCalledWith('/test/backup/dir/TestPersonality');
    });

    it('should return false if personality directory does not exist', async () => {
      mockFs.access.mockRejectedValue(new Error('ENOENT'));

      const exists = await repository.exists('TestPersonality');

      expect(exists).toBe(false);
    });
  });

  describe('private methods', () => {
    describe('_ensureDirectoryExists()', () => {
      it('should create directory recursively', async () => {
        await repository._ensureDirectoryExists('/test/path');

        expect(mockFs.mkdir).toHaveBeenCalledWith('/test/path', { recursive: true });
      });
    });

    describe('_loadMetadata()', () => {
      it('should load and parse metadata', async () => {
        const metadataData = { lastBackup: '2023-01-01T00:00:00.000Z' };
        mockFs.readFile.mockResolvedValue(JSON.stringify(metadataData));

        const metadata = await repository._loadMetadata('TestPersonality');

        expect(metadata).toBeInstanceOf(BackupMetadata);
        expect(metadata.lastBackup).toBe('2023-01-01T00:00:00.000Z');
      });

      it('should return default metadata if file does not exist', async () => {
        mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

        const metadata = await repository._loadMetadata('TestPersonality');

        expect(metadata).toBeInstanceOf(BackupMetadata);
        expect(metadata.lastBackup).toBeNull();
      });
    });

    describe('_saveMetadata()', () => {
      it('should save metadata to file', async () => {
        const metadata = new BackupMetadata({ lastBackup: '2023-01-01T00:00:00.000Z' });

        await repository._saveMetadata('TestPersonality', metadata);

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          '/test/backup/dir/TestPersonality/.backup-metadata.json',
          expect.stringContaining('"lastBackup": "2023-01-01T00:00:00.000Z"')
        );
      });
    });

    describe('data loading methods', () => {
      it('should handle missing files gracefully', async () => {
        mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

        const memories = await repository._loadMemories('TestPersonality');
        const knowledge = await repository._loadKnowledge('TestPersonality');
        const training = await repository._loadTraining('TestPersonality');
        const userPersonalization = await repository._loadUserPersonalization('TestPersonality');
        const chatHistory = await repository._loadChatHistory('TestPersonality');

        expect(memories).toEqual([]);
        expect(knowledge).toEqual([]);
        expect(training).toEqual([]);
        expect(userPersonalization).toEqual({});
        expect(chatHistory).toEqual([]);
      });

      it('should extract messages from chat history structure', async () => {
        const chatData = {
          messages: [{ ts: 1609459200, content: 'Message 1' }],
        };
        mockFs.readFile.mockResolvedValue(JSON.stringify(chatData));

        const chatHistory = await repository._loadChatHistory('TestPersonality');

        expect(chatHistory).toEqual(chatData.messages);
      });
    });

    describe('data saving methods', () => {
      it('should save data with proper formatting', async () => {
        const memories = [{ id: 'mem1', content: 'Memory 1' }];

        await repository._saveMemories('TestPersonality', memories);

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          '/test/backup/dir/TestPersonality/TestPersonality_memories.json',
          JSON.stringify(memories, null, 2)
        );

        expect(logger.info).toHaveBeenCalledWith(
          '[PersonalityDataRepository] Saved 1 memories for TestPersonality'
        );
      });

      it('should save chat history with metadata', async () => {
        const messages = [{ ts: 1609459200, content: 'Message 1' }];
        const personalityId = 'test-id';

        await repository._saveChatHistory('TestPersonality', messages, personalityId);

        const expectedChatData = {
          shape_id: personalityId,
          shape_name: 'TestPersonality',
          message_count: 1,
          date_range: {
            earliest: '2021-01-01T00:00:00.000Z',
            latest: '2021-01-01T00:00:00.000Z',
          },
          export_date: expect.any(String),
          messages: messages,
        };

        expect(mockFs.writeFile).toHaveBeenCalledWith(
          '/test/backup/dir/TestPersonality/TestPersonality_chat_history.json',
          expect.stringContaining('"export_date":')
        );
      });
    });
  });
});
