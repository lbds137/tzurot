/**
 * Tests for PersonalityData domain entity
 */

const {
  PersonalityData,
  BackupMetadata,
} = require('../../../../src/domain/backup/PersonalityData');

describe('BackupMetadata', () => {
  let metadata;

  beforeEach(() => {
    metadata = new BackupMetadata();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      expect(metadata.lastBackup).toBeNull();
      expect(metadata.lastMemoryTimestamp).toBeNull();
      expect(metadata.totalMemories).toBe(0);
      expect(metadata.lastKnowledgeSync).toBeNull();
      expect(metadata.totalKnowledge).toBe(0);
      expect(metadata.lastTrainingSync).toBeNull();
      expect(metadata.totalTraining).toBe(0);
      expect(metadata.lastUserPersonalizationSync).toBeNull();
      expect(metadata.lastChatHistorySync).toBeNull();
      expect(metadata.totalChatMessages).toBe(0);
      expect(metadata.oldestChatMessage).toBeNull();
      expect(metadata.newestChatMessage).toBeNull();
    });

    it('should accept initial values', () => {
      const initialData = {
        lastBackup: '2023-01-01T00:00:00.000Z',
        totalMemories: 5,
        totalKnowledge: 3,
      };

      const customMetadata = new BackupMetadata(initialData);

      expect(customMetadata.lastBackup).toBe('2023-01-01T00:00:00.000Z');
      expect(customMetadata.totalMemories).toBe(5);
      expect(customMetadata.totalKnowledge).toBe(3);
      expect(customMetadata.totalTraining).toBe(0); // Should still use default
    });
  });

  describe('markBackupComplete()', () => {
    it('should set lastBackup to current ISO string', () => {
      const beforeTime = new Date();
      metadata.markBackupComplete();
      const afterTime = new Date();

      expect(metadata.lastBackup).toBeDefined();
      const backupTime = new Date(metadata.lastBackup);
      expect(backupTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(backupTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('updateMemorySync()', () => {
    it('should update memory count', () => {
      metadata.updateMemorySync(10);
      expect(metadata.totalMemories).toBe(10);
    });

    it('should update memory count and timestamp', () => {
      metadata.updateMemorySync(15, 1609459200);
      expect(metadata.totalMemories).toBe(15);
      expect(metadata.lastMemoryTimestamp).toBe(1609459200);
    });

    it('should not update timestamp if not provided', () => {
      metadata.lastMemoryTimestamp = 1234567890;
      metadata.updateMemorySync(5);
      expect(metadata.lastMemoryTimestamp).toBe(1234567890);
    });
  });

  describe('updateKnowledgeSync()', () => {
    it('should update knowledge count and sync time', () => {
      const beforeTime = new Date();
      metadata.updateKnowledgeSync(7);
      const afterTime = new Date();

      expect(metadata.totalKnowledge).toBe(7);
      expect(metadata.lastKnowledgeSync).toBeDefined();
      const syncTime = new Date(metadata.lastKnowledgeSync);
      expect(syncTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(syncTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('updateTrainingSync()', () => {
    it('should update training count and sync time', () => {
      const beforeTime = new Date();
      metadata.updateTrainingSync(3);
      const afterTime = new Date();

      expect(metadata.totalTraining).toBe(3);
      expect(metadata.lastTrainingSync).toBeDefined();
      const syncTime = new Date(metadata.lastTrainingSync);
      expect(syncTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(syncTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('updateUserPersonalizationSync()', () => {
    it('should update sync time', () => {
      const beforeTime = new Date();
      metadata.updateUserPersonalizationSync();
      const afterTime = new Date();

      expect(metadata.lastUserPersonalizationSync).toBeDefined();
      const syncTime = new Date(metadata.lastUserPersonalizationSync);
      expect(syncTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(syncTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });

  describe('updateChatHistorySync()', () => {
    it('should update chat history metadata', () => {
      const beforeTime = new Date();
      metadata.updateChatHistorySync(100, '2023-01-01T00:00:00.000Z', '2023-12-31T23:59:59.999Z');
      const afterTime = new Date();

      expect(metadata.totalChatMessages).toBe(100);
      expect(metadata.oldestChatMessage).toBe('2023-01-01T00:00:00.000Z');
      expect(metadata.newestChatMessage).toBe('2023-12-31T23:59:59.999Z');
      expect(metadata.lastChatHistorySync).toBeDefined();
      const syncTime = new Date(metadata.lastChatHistorySync);
      expect(syncTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(syncTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });

    it('should update only total messages if timestamps not provided', () => {
      metadata.oldestChatMessage = 'existing-oldest';
      metadata.newestChatMessage = 'existing-newest';

      metadata.updateChatHistorySync(50);

      expect(metadata.totalChatMessages).toBe(50);
      expect(metadata.oldestChatMessage).toBe('existing-oldest');
      expect(metadata.newestChatMessage).toBe('existing-newest');
    });
  });
});

describe('PersonalityData', () => {
  let personalityData;

  beforeEach(() => {
    personalityData = new PersonalityData('TestPersonality', 'test-id-123');
  });

  describe('constructor', () => {
    it('should initialize with name and optional ID', () => {
      expect(personalityData.name).toBe('TestPersonality');
      expect(personalityData.id).toBe('test-id-123');
      expect(personalityData.profile).toBeNull();
      expect(personalityData.memories).toEqual([]);
      expect(personalityData.knowledge).toEqual([]);
      expect(personalityData.training).toEqual([]);
      expect(personalityData.userPersonalization).toEqual({});
      expect(personalityData.chatHistory).toEqual([]);
      expect(personalityData.metadata).toBeInstanceOf(BackupMetadata);
    });

    it('should work without ID', () => {
      const data = new PersonalityData('TestPersonality');
      expect(data.name).toBe('TestPersonality');
      expect(data.id).toBeNull();
    });
  });

  describe('updateProfile()', () => {
    it('should update profile data', () => {
      const profileData = {
        id: 'profile-id-456',
        name: 'TestPersonality',
        description: 'A test personality',
      };

      personalityData.updateProfile(profileData);

      expect(personalityData.profile).toEqual(profileData);
    });

    it('should set ID from profile if not already set', () => {
      const dataWithoutId = new PersonalityData('TestPersonality');
      const profileData = { id: 'profile-id-789', name: 'TestPersonality' };

      dataWithoutId.updateProfile(profileData);

      expect(dataWithoutId.id).toBe('profile-id-789');
    });

    it('should not overwrite existing ID', () => {
      const profileData = { id: 'different-id', name: 'TestPersonality' };

      personalityData.updateProfile(profileData);

      expect(personalityData.id).toBe('test-id-123'); // Original ID preserved
    });
  });

  describe('syncMemories()', () => {
    beforeEach(() => {
      // Add some existing memories
      personalityData.memories = [
        { id: 'mem1', content: 'Memory 1', created_at: 1609459200 },
        { id: 'mem2', content: 'Memory 2', created_at: 1609459300 },
      ];
      personalityData.metadata.totalMemories = 2;
    });

    it('should add new memories and sort chronologically', () => {
      const newMemories = [
        { id: 'mem3', content: 'Memory 3', created_at: 1609459400 },
        { id: 'mem0', content: 'Memory 0', created_at: 1609459100 }, // Earlier than existing
      ];

      const result = personalityData.syncMemories(newMemories);

      expect(result.hasNewMemories).toBe(true);
      expect(result.newMemoryCount).toBe(2);
      expect(result.totalMemories).toBe(4);
      expect(personalityData.memories).toHaveLength(4);

      // Check chronological order
      const timestamps = personalityData.memories.map(m => m.created_at);
      expect(timestamps).toEqual([1609459100, 1609459200, 1609459300, 1609459400]);
    });

    it('should filter out duplicate memories', () => {
      const duplicateMemories = [
        { id: 'mem1', content: 'Duplicate Memory 1', created_at: 1609459200 },
        { id: 'mem4', content: 'New Memory 4', created_at: 1609459500 },
      ];

      const result = personalityData.syncMemories(duplicateMemories);

      expect(result.hasNewMemories).toBe(true);
      expect(result.newMemoryCount).toBe(1);
      expect(result.totalMemories).toBe(3);
      expect(personalityData.memories.some(m => m.id === 'mem4')).toBe(true);
    });

    it('should handle no new memories', () => {
      const existingMemories = [
        { id: 'mem1', content: 'Memory 1', created_at: 1609459200 },
        { id: 'mem2', content: 'Memory 2', created_at: 1609459300 },
      ];

      const result = personalityData.syncMemories(existingMemories);

      expect(result.hasNewMemories).toBe(false);
      expect(result.newMemoryCount).toBe(0);
      expect(result.totalMemories).toBe(2);
    });

    it('should handle memories with ISO string timestamps', () => {
      const newMemories = [
        { id: 'mem3', content: 'Memory 3', created_at: '2021-01-01T01:00:00.000Z' },
      ];

      const result = personalityData.syncMemories(newMemories);

      expect(result.hasNewMemories).toBe(true);
      expect(personalityData.memories).toHaveLength(3);
    });

    it('should update metadata with latest timestamp', () => {
      const newMemories = [{ id: 'mem3', content: 'Memory 3', created_at: 1609459500 }];

      personalityData.syncMemories(newMemories);

      expect(personalityData.metadata.totalMemories).toBe(3);
      expect(personalityData.metadata.lastMemoryTimestamp).toBe(1609459500);
    });

    it('should throw error for non-array input', () => {
      expect(() => {
        personalityData.syncMemories('not an array');
      }).toThrow('Memories must be an array');
    });
  });

  describe('updateKnowledge()', () => {
    it('should update knowledge and metadata when data changes', () => {
      const knowledgeData = [
        { id: 'know1', content: 'Knowledge 1' },
        { id: 'know2', content: 'Knowledge 2' },
      ];

      const result = personalityData.updateKnowledge(knowledgeData);

      expect(result.hasNewKnowledge).toBe(true);
      expect(result.knowledgeCount).toBe(2);
      expect(personalityData.knowledge).toEqual(knowledgeData);
      expect(personalityData.metadata.totalKnowledge).toBe(2);
      expect(personalityData.metadata.lastKnowledgeSync).toBeDefined();
    });

    it('should detect no changes when data is identical', () => {
      const knowledgeData = [{ id: 'know1', content: 'Knowledge 1' }];

      // Set initial data
      personalityData.updateKnowledge(knowledgeData);

      // Update with same data
      const result = personalityData.updateKnowledge(knowledgeData);

      expect(result.hasNewKnowledge).toBe(false);
      expect(result.knowledgeCount).toBe(1);
    });

    it('should throw error for non-array input', () => {
      expect(() => {
        personalityData.updateKnowledge('not an array');
      }).toThrow('Knowledge data must be an array');
    });
  });

  describe('updateTraining()', () => {
    it('should update training and metadata when data changes', () => {
      const trainingData = [
        { id: 'train1', input: 'Input 1', output: 'Output 1' },
        { id: 'train2', input: 'Input 2', output: 'Output 2' },
      ];

      const result = personalityData.updateTraining(trainingData);

      expect(result.hasNewTraining).toBe(true);
      expect(result.trainingCount).toBe(2);
      expect(personalityData.training).toEqual(trainingData);
      expect(personalityData.metadata.totalTraining).toBe(2);
      expect(personalityData.metadata.lastTrainingSync).toBeDefined();
    });

    it('should detect no changes when data is identical', () => {
      const trainingData = [{ id: 'train1', input: 'Input 1', output: 'Output 1' }];

      // Set initial data
      personalityData.updateTraining(trainingData);

      // Update with same data
      const result = personalityData.updateTraining(trainingData);

      expect(result.hasNewTraining).toBe(false);
      expect(result.trainingCount).toBe(1);
    });

    it('should throw error for non-array input', () => {
      expect(() => {
        personalityData.updateTraining('not an array');
      }).toThrow('Training data must be an array');
    });
  });

  describe('updateUserPersonalization()', () => {
    it('should update user personalization when data changes', () => {
      const personalizationData = {
        preferences: { theme: 'dark' },
        settings: { notifications: true },
      };

      const result = personalityData.updateUserPersonalization(personalizationData);

      expect(result.hasNewUserPersonalization).toBe(true);
      expect(personalityData.userPersonalization).toEqual(personalizationData);
      expect(personalityData.metadata.lastUserPersonalizationSync).toBeDefined();
    });

    it('should detect no changes when data is identical', () => {
      const personalizationData = { preferences: { theme: 'dark' } };

      // Set initial data
      personalityData.updateUserPersonalization(personalizationData);

      // Update with same data
      const result = personalityData.updateUserPersonalization(personalizationData);

      expect(result.hasNewUserPersonalization).toBe(false);
    });

    it('should throw error for non-object input', () => {
      expect(() => {
        personalityData.updateUserPersonalization('not an object');
      }).toThrow('User personalization data must be an object');

      expect(() => {
        personalityData.updateUserPersonalization(null);
      }).toThrow('User personalization data must be an object');
    });
  });

  describe('syncChatHistory()', () => {
    beforeEach(() => {
      // Add some existing chat history
      personalityData.chatHistory = [
        { ts: 1609459200, content: 'Message 1' },
        { ts: 1609459300, content: 'Message 2' },
      ];
    });

    it('should add only new messages', () => {
      const newMessages = [
        { ts: 1609459250, content: 'Message between' }, // Should be filtered out (older)
        { ts: 1609459400, content: 'Message 3' },
        { ts: 1609459500, content: 'Message 4' },
      ];

      const result = personalityData.syncChatHistory(newMessages);

      expect(result.hasNewMessages).toBe(true);
      expect(result.newMessageCount).toBe(2);
      expect(result.totalMessages).toBe(4);
      expect(personalityData.chatHistory).toHaveLength(4);

      // Check that only messages newer than existing were added
      const lastTwoMessages = personalityData.chatHistory.slice(-2);
      expect(lastTwoMessages[0].content).toBe('Message 3');
      expect(lastTwoMessages[1].content).toBe('Message 4');
    });

    it('should handle no new messages', () => {
      const oldMessages = [
        { ts: 1609459100, content: 'Old Message' },
        { ts: 1609459200, content: 'Duplicate Message' },
      ];

      const result = personalityData.syncChatHistory(oldMessages);

      expect(result.hasNewMessages).toBe(false);
      expect(result.newMessageCount).toBe(0);
      expect(result.totalMessages).toBe(2); // Original count unchanged
    });

    it('should update metadata with date range', () => {
      const newMessages = [{ ts: 1609459400, content: 'Message 3' }];

      personalityData.syncChatHistory(newMessages);

      expect(personalityData.metadata.totalChatMessages).toBe(3);
      expect(personalityData.metadata.lastChatHistorySync).toBeDefined();
      expect(personalityData.metadata.oldestChatMessage).toBe('2021-01-01T00:00:00.000Z');
      expect(personalityData.metadata.newestChatMessage).toBe('2021-01-01T00:03:20.000Z');
    });

    it('should throw error for non-array input', () => {
      expect(() => {
        personalityData.syncChatHistory('not an array');
      }).toThrow('Chat messages must be an array');
    });
  });

  describe('getSummary()', () => {
    it('should return comprehensive summary', () => {
      personalityData.updateProfile({ id: 'profile-123', name: 'Test' });
      personalityData.syncMemories([{ id: 'mem1', created_at: 1609459200 }]);
      personalityData.updateKnowledge([{ id: 'know1' }]);
      personalityData.updateTraining([{ id: 'train1' }, { id: 'train2' }]);
      personalityData.updateUserPersonalization({ theme: 'dark' });
      personalityData.syncChatHistory([{ ts: 1609459200 }]);
      personalityData.markBackupComplete();

      const summary = personalityData.getSummary();

      expect(summary).toEqual({
        name: 'TestPersonality',
        id: 'test-id-123',
        hasProfile: true,
        memoriesCount: 1,
        knowledgeCount: 1,
        trainingCount: 2,
        chatMessagesCount: 1,
        hasUserPersonalization: true,
        lastBackup: expect.any(String),
        dateRange: {
          oldest: '2021-01-01T00:00:00.000Z',
          newest: '2021-01-01T00:00:00.000Z',
        },
      });
    });

    it('should handle empty data', () => {
      const summary = personalityData.getSummary();

      expect(summary).toEqual({
        name: 'TestPersonality',
        id: 'test-id-123',
        hasProfile: false,
        memoriesCount: 0,
        knowledgeCount: 0,
        trainingCount: 0,
        chatMessagesCount: 0,
        hasUserPersonalization: false,
        lastBackup: null,
        dateRange: null,
      });
    });
  });

  describe('markBackupComplete()', () => {
    it('should update metadata backup timestamp', () => {
      const beforeTime = new Date();
      personalityData.markBackupComplete();
      const afterTime = new Date();

      expect(personalityData.metadata.lastBackup).toBeDefined();
      const backupTime = new Date(personalityData.metadata.lastBackup);
      expect(backupTime.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(backupTime.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });
});
