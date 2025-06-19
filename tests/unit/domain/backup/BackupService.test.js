/**
 * Tests for BackupService domain service
 */

const { BackupService } = require('../../../../src/domain/backup/BackupService');
const { BackupJob, BackupStatus } = require('../../../../src/domain/backup/BackupJob');
const { PersonalityData } = require('../../../../src/domain/backup/PersonalityData');
const logger = require('../../../../src/logger');

// Mock logger
jest.mock('../../../../src/logger');

describe('BackupService', () => {
  let backupService;
  let mockPersonalityDataRepository;
  let mockApiClientService;
  let mockAuthenticationService;
  let mockDelayFn;
  let mockProgressCallback;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock dependencies
    mockPersonalityDataRepository = {
      load: jest.fn(),
      save: jest.fn(),
    };

    mockApiClientService = {
      fetchCurrentUser: jest.fn(),
      fetchPersonalityProfile: jest.fn(),
      fetchAllMemories: jest.fn(),
      fetchKnowledgeData: jest.fn(),
      fetchTrainingData: jest.fn(),
      fetchUserPersonalizationData: jest.fn(),
      fetchChatHistory: jest.fn(),
    };

    mockAuthenticationService = {};

    mockDelayFn = jest.fn().mockResolvedValue(undefined);

    mockProgressCallback = jest.fn().mockResolvedValue(undefined);

    // Create service with mocked dependencies
    backupService = new BackupService({
      personalityDataRepository: mockPersonalityDataRepository,
      apiClientService: mockApiClientService,
      authenticationService: mockAuthenticationService,
      delayFn: mockDelayFn,
    });
  });

  describe('constructor', () => {
    it('should initialize with dependencies', () => {
      expect(backupService.personalityDataRepository).toBe(mockPersonalityDataRepository);
      expect(backupService.apiClientService).toBe(mockApiClientService);
      expect(backupService.authenticationService).toBe(mockAuthenticationService);
      expect(backupService.delayFn).toBe(mockDelayFn);
      expect(backupService.delayBetweenRequests).toBe(1000);
    });

    it('should use default delay function if not provided', () => {
      const serviceWithDefaults = new BackupService({
        personalityDataRepository: mockPersonalityDataRepository,
        apiClientService: mockApiClientService,
        authenticationService: mockAuthenticationService,
      });

      expect(typeof serviceWithDefaults.delayFn).toBe('function');
    });
  });

  describe('executeBackup()', () => {
    let job;
    let authData;
    let personalityData;

    beforeEach(() => {
      job = new BackupJob({
        personalityName: 'TestPersonality',
        userId: 'user123',
      });

      authData = { cookie: 'session-cookie' };

      personalityData = new PersonalityData('TestPersonality', 'personality-id-123');
      mockPersonalityDataRepository.load.mockResolvedValue(personalityData);
      mockPersonalityDataRepository.save.mockResolvedValue(undefined);

      // Mock ownership check - user is owner
      mockApiClientService.fetchCurrentUser.mockResolvedValue({
        id: 'user123',
        username: 'testuser',
      });

      // Mock successful API responses
      mockApiClientService.fetchPersonalityProfile.mockResolvedValue({
        id: 'personality-id-123',
        name: 'TestPersonality',
        description: 'Test description',
        user_id: 'user123', // Same as current user - makes them owner
      });

      mockApiClientService.fetchAllMemories.mockResolvedValue([
        { id: 'mem1', content: 'Memory 1', created_at: 1609459200 },
      ]);

      mockApiClientService.fetchKnowledgeData.mockResolvedValue([
        { id: 'know1', content: 'Knowledge 1' },
      ]);

      mockApiClientService.fetchTrainingData.mockResolvedValue([
        { id: 'train1', input: 'Input 1', output: 'Output 1' },
      ]);

      mockApiClientService.fetchUserPersonalizationData.mockResolvedValue({
        preferences: { theme: 'dark' },
      });

      mockApiClientService.fetchChatHistory.mockResolvedValue([
        { ts: 1609459200, content: 'Chat message 1' },
      ]);
    });

    it('should execute complete backup successfully', async () => {
      const result = await backupService.executeBackup(job, authData, mockProgressCallback);

      expect(result).toBe(job);
      expect(job.status).toBe(BackupStatus.COMPLETED);
      expect(job.results.profile.updated).toBe(true);
      expect(job.results.memories.newCount).toBe(1);
      expect(job.results.memories.totalCount).toBe(1);
      expect(job.results.knowledge.updated).toBe(true);
      expect(job.results.knowledge.entryCount).toBe(1);
      expect(job.results.training.updated).toBe(true);
      expect(job.results.training.entryCount).toBe(1);
      expect(job.results.userPersonalization.updated).toBe(true);
      expect(job.results.chatHistory.newMessageCount).toBe(1);
      expect(job.results.chatHistory.totalMessages).toBe(1);

      // Verify API calls were made
      expect(mockApiClientService.fetchPersonalityProfile).toHaveBeenCalledWith(
        'TestPersonality',
        authData
      );
      expect(mockApiClientService.fetchAllMemories).toHaveBeenCalledWith(
        'personality-id-123',
        'TestPersonality',
        authData
      );
      expect(mockApiClientService.fetchKnowledgeData).toHaveBeenCalledWith(
        'personality-id-123',
        'TestPersonality',
        authData
      );
      expect(mockApiClientService.fetchTrainingData).toHaveBeenCalledWith(
        'personality-id-123',
        'TestPersonality',
        authData
      );
      expect(mockApiClientService.fetchUserPersonalizationData).toHaveBeenCalledWith(
        'personality-id-123',
        'TestPersonality',
        authData
      );
      expect(mockApiClientService.fetchChatHistory).toHaveBeenCalledWith(
        'personality-id-123',
        'TestPersonality',
        authData
      );

      // Verify delays were applied
      expect(mockDelayFn).toHaveBeenCalledTimes(5);
      expect(mockDelayFn).toHaveBeenCalledWith(1000);

      // Verify data was saved
      expect(mockPersonalityDataRepository.save).toHaveBeenCalledWith(personalityData);

      // Verify progress callbacks
      expect(mockProgressCallback).toHaveBeenCalledWith(
        '🔄 Starting backup for **TestPersonality**...'
      );
      expect(mockProgressCallback).toHaveBeenCalledWith(
        expect.stringContaining('✅ Backup complete for **TestPersonality**')
      );
    });

    it('should handle personality without ID (profile only)', async () => {
      // Create a fresh personality data without ID for this test
      const personalityDataNoId = new PersonalityData('TestPersonality');
      mockPersonalityDataRepository.load.mockResolvedValueOnce(personalityDataNoId);

      // Mock profile without ID
      mockApiClientService.fetchPersonalityProfile.mockResolvedValue({
        name: 'TestPersonality',
        description: 'Test description',
        // No ID field
      });

      const result = await backupService.executeBackup(job, authData, mockProgressCallback);

      expect(result.status).toBe(BackupStatus.COMPLETED);
      expect(result.results.profile.updated).toBe(false);
      expect(result.results.profile.skipped).toBe(true);
      expect(result.results.profile.reason).toBe('Non-owner: Limited public profile data only');

      // Other API methods should not be called for personality without ID
      expect(mockApiClientService.fetchAllMemories).not.toHaveBeenCalled();
      expect(mockApiClientService.fetchKnowledgeData).not.toHaveBeenCalled();
      expect(mockApiClientService.fetchTrainingData).not.toHaveBeenCalled();
      expect(mockApiClientService.fetchUserPersonalizationData).not.toHaveBeenCalled();
      expect(mockApiClientService.fetchChatHistory).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      const apiError = new Error('API request failed');
      mockApiClientService.fetchPersonalityProfile.mockRejectedValue(apiError);

      await expect(
        backupService.executeBackup(job, authData, mockProgressCallback)
      ).rejects.toThrow('API request failed');

      expect(job.status).toBe(BackupStatus.FAILED);
      expect(job.error.message).toBe('API request failed');

      expect(logger.error).toHaveBeenCalledWith(
        '[BackupService] Backup failed for TestPersonality: API request failed'
      );

      expect(mockProgressCallback).toHaveBeenCalledWith(
        '❌ Failed to backup **TestPersonality**: API request failed'
      );
    });

    it('should validate job parameter', async () => {
      const invalidJob = { personalityName: 'Test' }; // Not a BackupJob instance

      await expect(backupService.executeBackup(invalidJob, authData)).rejects.toThrow(
        'Invalid job: must be BackupJob instance'
      );
    });

    it('should validate job status', async () => {
      job.start(); // Move to IN_PROGRESS status

      await expect(backupService.executeBackup(job, authData)).rejects.toThrow(
        'Cannot execute job in status: in_progress'
      );
    });

    it('should work without progress callback', async () => {
      const result = await backupService.executeBackup(job, authData);

      expect(result.status).toBe(BackupStatus.COMPLETED);
      // Should not throw errors when progress callback is null
    });
  });

  describe('executeBulkBackup()', () => {
    let authData;

    beforeEach(() => {
      authData = { cookie: 'session-cookie' };

      // Mock successful single backup execution
      jest.spyOn(backupService, 'executeBackupWithCachedUser').mockImplementation(async job => {
        job.start();
        job.complete({});
        return job;
      });
    });

    afterEach(() => {
      // Clean up any spies to avoid test pollution
      jest.restoreAllMocks();
    });

    it('should execute bulk backup for multiple personalities', async () => {
      const personalityNames = ['Personality1', 'Personality2', 'Personality3'];
      const userId = 'user123';

      const jobs = await backupService.executeBulkBackup(
        personalityNames,
        userId,
        authData,
        mockProgressCallback
      );

      expect(jobs).toHaveLength(3);
      expect(backupService.executeBackupWithCachedUser).toHaveBeenCalledTimes(3);

      // Verify each job was created correctly
      jobs.forEach((job, index) => {
        expect(job.personalityName).toBe(personalityNames[index]);
        expect(job.userId).toBe(userId);
        expect(job.isBulk).toBe(true);
        expect(job.status).toBe(BackupStatus.COMPLETED);
      });

      // Verify progress messages
      expect(mockProgressCallback).toHaveBeenCalledWith(
        '📦 Starting bulk backup of 3 personalities...\nThis may take a few minutes.'
      );
      expect(mockProgressCallback).toHaveBeenCalledWith(
        '\n✅ Bulk backup complete! Backed up 3 personalities.'
      );

      // Verify delays between personalities
      expect(mockDelayFn).toHaveBeenCalledWith(2000); // delayBetweenRequests * 2
    });

    it('should handle authentication errors and stop bulk operation', async () => {
      const authError = new Error('Authentication failed');
      authError.status = 401;

      // Mock first backup to succeed, second to fail with auth error
      jest
        .spyOn(backupService, 'executeBackupWithCachedUser')
        .mockResolvedValueOnce({ status: BackupStatus.COMPLETED })
        .mockRejectedValueOnce(authError);

      const personalityNames = ['Personality1', 'Personality2', 'Personality3'];

      const jobs = await backupService.executeBulkBackup(
        personalityNames,
        'user123',
        authData,
        mockProgressCallback
      );

      expect(jobs).toHaveLength(3);
      expect(backupService.executeBackupWithCachedUser).toHaveBeenCalledTimes(2); // Stopped after auth error

      expect(mockProgressCallback).toHaveBeenCalledWith(
        expect.stringContaining('❌ Authentication failed! Your session cookie may have expired.')
      );
      expect(mockProgressCallback).toHaveBeenCalledWith(
        expect.stringContaining('Successfully backed up 1 of 3 personalities before failure.')
      );
    });

    it('should continue on non-authentication errors', async () => {
      const generalError = new Error('Network error');

      // Mock second backup to fail with non-auth error
      jest
        .spyOn(backupService, 'executeBackupWithCachedUser')
        .mockResolvedValueOnce({ status: BackupStatus.COMPLETED })
        .mockRejectedValueOnce(generalError)
        .mockResolvedValueOnce({ status: BackupStatus.COMPLETED });

      const personalityNames = ['Personality1', 'Personality2', 'Personality3'];

      const jobs = await backupService.executeBulkBackup(
        personalityNames,
        'user123',
        authData,
        mockProgressCallback
      );

      expect(backupService.executeBackupWithCachedUser).toHaveBeenCalledTimes(3); // Continued after error
      expect(logger.error).toHaveBeenCalledWith(
        '[BackupService] Error in bulk backup for Personality2: Network error'
      );
    });

    it('should validate input parameters', async () => {
      // Empty array
      await expect(backupService.executeBulkBackup([], 'user123', authData)).rejects.toThrow(
        'Invalid personality names: must be non-empty array'
      );

      // Non-array input
      await expect(
        backupService.executeBulkBackup('not-array', 'user123', authData)
      ).rejects.toThrow('Invalid personality names: must be non-empty array');
    });

    it('should work without progress callback', async () => {
      const personalityNames = ['Personality1'];

      const jobs = await backupService.executeBulkBackup(personalityNames, 'user123', authData);

      expect(jobs).toHaveLength(1);
      // Should not throw errors when progress callback is null
    });
  });

  describe('_isAuthenticationError()', () => {
    it('should identify authentication errors by status code', () => {
      const authError = new Error('Unauthorized');
      authError.status = 401;

      expect(backupService._isAuthenticationError(authError)).toBe(true);
    });

    it('should identify authentication errors by message content', () => {
      const authError1 = new Error('401 Unauthorized');
      const authError2 = new Error('Authentication required');
      const authError3 = new Error('Session cookie expired');

      expect(backupService._isAuthenticationError(authError1)).toBe(true);
      expect(backupService._isAuthenticationError(authError2)).toBe(true);
      expect(backupService._isAuthenticationError(authError3)).toBe(true);
    });

    it('should not identify non-authentication errors', () => {
      const networkError = new Error('Network timeout');
      const serverError = new Error('Internal server error');
      serverError.status = 500;

      expect(backupService._isAuthenticationError(networkError)).toBe(false);
      expect(backupService._isAuthenticationError(serverError)).toBe(false);
    });

    it('should handle null/undefined errors', () => {
      expect(backupService._isAuthenticationError(null)).toBe(false);
      expect(backupService._isAuthenticationError(undefined)).toBe(false);
    });
  });

  describe('private backup methods', () => {
    let personalityData;
    let authData;

    beforeEach(() => {
      personalityData = new PersonalityData('TestPersonality', 'test-id');
      authData = { cookie: 'session-cookie' };
    });

    describe('_backupProfile()', () => {
      it('should fetch and update profile', async () => {
        const profileData = { id: 'test-id', name: 'TestPersonality' };
        mockApiClientService.fetchPersonalityProfile.mockResolvedValue(profileData);

        await backupService._backupProfile(personalityData, authData);

        expect(mockApiClientService.fetchPersonalityProfile).toHaveBeenCalledWith(
          'TestPersonality',
          authData
        );
        expect(personalityData.profile).toEqual(profileData);
      });
    });

    describe('_backupMemories()', () => {
      it('should fetch and sync memories', async () => {
        const memories = [{ id: 'mem1', content: 'Memory 1', created_at: 1609459200 }];
        mockApiClientService.fetchAllMemories.mockResolvedValue(memories);

        const result = await backupService._backupMemories(personalityData, authData);

        expect(mockApiClientService.fetchAllMemories).toHaveBeenCalledWith(
          'test-id',
          'TestPersonality',
          authData
        );
        expect(result.hasNewMemories).toBe(true);
        expect(result.newMemoryCount).toBe(1);
      });
    });

    describe('_backupKnowledge()', () => {
      it('should fetch and update knowledge', async () => {
        const knowledge = [{ id: 'know1', content: 'Knowledge 1' }];
        mockApiClientService.fetchKnowledgeData.mockResolvedValue(knowledge);

        const result = await backupService._backupKnowledge(personalityData, authData);

        expect(mockApiClientService.fetchKnowledgeData).toHaveBeenCalledWith(
          'test-id',
          'TestPersonality',
          authData
        );
        expect(result.hasNewKnowledge).toBe(true);
        expect(result.knowledgeCount).toBe(1);
      });
    });

    describe('_backupTraining()', () => {
      it('should fetch and update training', async () => {
        const training = [{ id: 'train1', input: 'Input', output: 'Output' }];
        mockApiClientService.fetchTrainingData.mockResolvedValue(training);

        const result = await backupService._backupTraining(personalityData, authData);

        expect(mockApiClientService.fetchTrainingData).toHaveBeenCalledWith(
          'test-id',
          'TestPersonality',
          authData
        );
        expect(result.hasNewTraining).toBe(true);
        expect(result.trainingCount).toBe(1);
      });
    });

    describe('_backupUserPersonalization()', () => {
      it('should fetch and update user personalization', async () => {
        const userPersonalization = { preferences: { theme: 'dark' } };
        mockApiClientService.fetchUserPersonalizationData.mockResolvedValue(userPersonalization);

        const result = await backupService._backupUserPersonalization(personalityData, authData);

        expect(mockApiClientService.fetchUserPersonalizationData).toHaveBeenCalledWith(
          'test-id',
          'TestPersonality',
          authData
        );
        expect(result.hasNewUserPersonalization).toBe(true);
      });
    });

    describe('_backupChatHistory()', () => {
      it('should fetch and sync chat history', async () => {
        const chatHistory = [{ ts: 1609459200, content: 'Chat message' }];
        mockApiClientService.fetchChatHistory.mockResolvedValue(chatHistory);

        const result = await backupService._backupChatHistory(personalityData, authData);

        expect(mockApiClientService.fetchChatHistory).toHaveBeenCalledWith(
          'test-id',
          'TestPersonality',
          authData
        );
        expect(result.hasNewMessages).toBe(true);
        expect(result.newMessageCount).toBe(1);
      });
    });
  });
});
