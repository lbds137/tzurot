/**
 * Tests for BackupJob domain entity
 */

const { BackupJob, BackupStatus } = require('../../../../src/domain/backup/BackupJob');

describe('BackupJob', () => {
  let job;

  beforeEach(() => {
    job = new BackupJob({
      personalityName: 'TestPersonality',
      userId: 'user123',
      isBulk: false,
    });
  });

  describe('constructor', () => {
    it('should create job with required parameters', () => {
      expect(job.personalityName).toBe('TestPersonality');
      expect(job.userId).toBe('user123');
      expect(job.isBulk).toBe(false);
      expect(job.status).toBe(BackupStatus.PENDING);
      expect(job.createdAt).toBeInstanceOf(Date);
      expect(job.startedAt).toBeNull();
      expect(job.completedAt).toBeNull();
      expect(job.error).toBeNull();
    });

    it('should generate unique ID if not provided', () => {
      const job1 = new BackupJob({ personalityName: 'Test1', userId: 'user1' });
      const job2 = new BackupJob({ personalityName: 'Test2', userId: 'user1' });

      expect(job1.id).toBeDefined();
      expect(job2.id).toBeDefined();
      expect(job1.id).not.toBe(job2.id);
      expect(job1.id).toMatch(/^backup_\d+_[a-z0-9]+$/);
    });

    it('should use provided ID', () => {
      const customId = 'custom-job-id';
      const jobWithId = new BackupJob({
        personalityName: 'Test',
        userId: 'user1',
        id: customId,
      });

      expect(jobWithId.id).toBe(customId);
    });

    it('should default isBulk to false', () => {
      const simpleJob = new BackupJob({
        personalityName: 'Test',
        userId: 'user1',
      });

      expect(simpleJob.isBulk).toBe(false);
    });

    it('should initialize default results structure', () => {
      expect(job.results).toEqual({
        profile: { updated: false },
        memories: { newCount: 0, totalCount: 0 },
        knowledge: { updated: false, entryCount: 0 },
        training: { updated: false, entryCount: 0 },
        userPersonalization: { updated: false },
        chatHistory: { newMessageCount: 0, totalMessages: 0 },
      });
    });
  });

  describe('start()', () => {
    it('should transition from PENDING to IN_PROGRESS', () => {
      job.start();

      expect(job.status).toBe(BackupStatus.IN_PROGRESS);
      expect(job.startedAt).toBeInstanceOf(Date);
    });

    it('should throw error if not in PENDING status', () => {
      job.start();

      expect(() => job.start()).toThrow('Cannot start job in status: in_progress');
    });
  });

  describe('complete()', () => {
    beforeEach(() => {
      job.start();
    });

    it('should transition from IN_PROGRESS to COMPLETED', () => {
      const results = {
        memories: { newCount: 5, totalCount: 10 },
      };

      job.complete(results);

      expect(job.status).toBe(BackupStatus.COMPLETED);
      expect(job.completedAt).toBeInstanceOf(Date);
      expect(job.results.memories.newCount).toBe(5);
      expect(job.results.memories.totalCount).toBe(10);
    });

    it('should merge results with existing structure', () => {
      const results = {
        profile: { updated: true },
        knowledge: { updated: true, entryCount: 3 },
      };

      job.complete(results);

      expect(job.results.profile.updated).toBe(true);
      expect(job.results.knowledge.updated).toBe(true);
      expect(job.results.knowledge.entryCount).toBe(3);
      // Unchanged fields should remain default
      expect(job.results.memories.newCount).toBe(0);
    });

    it('should throw error if not in IN_PROGRESS status', () => {
      job.status = BackupStatus.PENDING;

      expect(() => job.complete({})).toThrow('Cannot complete job in status: pending');
    });
  });

  describe('fail()', () => {
    it('should transition to FAILED from any non-completed status', () => {
      const error = new Error('Test error');

      job.fail(error);

      expect(job.status).toBe(BackupStatus.FAILED);
      expect(job.completedAt).toBeInstanceOf(Date);
      expect(job.error).toEqual({
        message: 'Test error',
        stack: error.stack,
        timestamp: expect.any(Date),
      });
    });

    it('should fail from IN_PROGRESS status', () => {
      job.start();
      const error = new Error('Backup failed');

      job.fail(error);

      expect(job.status).toBe(BackupStatus.FAILED);
    });

    it('should throw error if job is already completed', () => {
      job.start();
      job.complete({});

      const error = new Error('Test error');
      expect(() => job.fail(error)).toThrow('Cannot fail a completed job');
    });
  });

  describe('getDuration()', () => {
    it('should return null if job not started', () => {
      expect(job.getDuration()).toBeNull();
    });

    it('should return duration if job is running', () => {
      job.start();
      // Small delay to ensure time difference
      const duration = job.getDuration();

      expect(duration).toBeGreaterThanOrEqual(0);
      expect(typeof duration).toBe('number');
    });

    it('should return total duration if job is completed', async () => {
      job.start();
      const startTime = job.startedAt.getTime();

      // Simulate some time passing with a promise
      await new Promise(resolve => setTimeout(resolve, 10));

      job.complete({});
      const duration = job.getDuration();
      const expectedDuration = job.completedAt.getTime() - startTime;

      expect(duration).toBe(expectedDuration);
    });
  });

  describe('isFinished()', () => {
    it('should return false for PENDING status', () => {
      expect(job.isFinished()).toBe(false);
    });

    it('should return false for IN_PROGRESS status', () => {
      job.start();
      expect(job.isFinished()).toBe(false);
    });

    it('should return true for COMPLETED status', () => {
      job.start();
      job.complete({});
      expect(job.isFinished()).toBe(true);
    });

    it('should return true for FAILED status', () => {
      job.fail(new Error('Test'));
      expect(job.isFinished()).toBe(true);
    });
  });

  describe('getStatusDescription()', () => {
    it('should return description for PENDING', () => {
      expect(job.getStatusDescription()).toBe('Waiting to start');
    });

    it('should return description for IN_PROGRESS', () => {
      job.start();
      expect(job.getStatusDescription()).toBe('Backup in progress');
    });

    it('should return description for COMPLETED', () => {
      job.start();
      job.complete({});
      expect(job.getStatusDescription()).toBe('Backup completed successfully');
    });

    it('should return description for FAILED with error message', () => {
      job.fail(new Error('Network error'));
      expect(job.getStatusDescription()).toBe('Backup failed: Network error');
    });

    it('should handle FAILED status without error message', () => {
      job.status = BackupStatus.FAILED;
      job.error = null;
      expect(job.getStatusDescription()).toBe('Backup failed: Unknown error');
    });
  });

  describe('updateResults()', () => {
    it('should update specific data type results', () => {
      job.updateResults('memories', { newCount: 5, totalCount: 15 });

      expect(job.results.memories.newCount).toBe(5);
      expect(job.results.memories.totalCount).toBe(15);
    });

    it('should merge with existing results', () => {
      job.results.memories.newCount = 3;
      job.updateResults('memories', { totalCount: 10 });

      expect(job.results.memories.newCount).toBe(3);
      expect(job.results.memories.totalCount).toBe(10);
    });

    it('should throw error for unknown data type', () => {
      expect(() => {
        job.updateResults('unknown', { value: 1 });
      }).toThrow('Unknown data type: unknown');
    });
  });

  describe('toJSON() and fromJSON()', () => {
    it('should serialize job to JSON', () => {
      job.start();
      job.updateResults('memories', { newCount: 5 });

      const json = job.toJSON();

      expect(json).toEqual({
        id: job.id,
        personalityName: 'TestPersonality',
        userId: 'user123',
        isBulk: false,
        persistToFilesystem: true,
        status: 'in_progress',
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt.toISOString(),
        completedAt: null,
        error: null,
        results: {
          profile: { updated: false },
          memories: { newCount: 5, totalCount: 0 },
          knowledge: { updated: false, entryCount: 0 },
          training: { updated: false, entryCount: 0 },
          userPersonalization: { updated: false },
          chatHistory: { newMessageCount: 0, totalMessages: 0 },
        },
      });
    });

    it('should deserialize job from JSON', () => {
      job.start();
      job.updateResults('knowledge', { updated: true, entryCount: 3 });
      job.complete({});

      const json = job.toJSON();
      const restoredJob = BackupJob.fromJSON(json);

      expect(restoredJob.id).toBe(job.id);
      expect(restoredJob.personalityName).toBe(job.personalityName);
      expect(restoredJob.userId).toBe(job.userId);
      expect(restoredJob.status).toBe(job.status);
      expect(restoredJob.createdAt).toEqual(job.createdAt);
      expect(restoredJob.startedAt).toEqual(job.startedAt);
      expect(restoredJob.completedAt).toEqual(job.completedAt);
      expect(restoredJob.results).toEqual(job.results);
    });

    it('should handle JSON with null timestamps', () => {
      const jsonData = {
        id: 'test-id',
        personalityName: 'Test',
        userId: 'user1',
        isBulk: false,
        status: 'pending',
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        error: null,
        results: {
          profile: { updated: false },
          memories: { newCount: 0, totalCount: 0 },
          knowledge: { updated: false, entryCount: 0 },
          training: { updated: false, entryCount: 0 },
          userPersonalization: { updated: false },
          chatHistory: { newMessageCount: 0, totalMessages: 0 },
        },
      };

      const restoredJob = BackupJob.fromJSON(jsonData);

      expect(restoredJob.startedAt).toBeNull();
      expect(restoredJob.completedAt).toBeNull();
    });
  });

  describe('BackupStatus constants', () => {
    it('should have correct status values', () => {
      expect(BackupStatus.PENDING).toBe('pending');
      expect(BackupStatus.IN_PROGRESS).toBe('in_progress');
      expect(BackupStatus.COMPLETED).toBe('completed');
      expect(BackupStatus.FAILED).toBe('failed');
    });
  });
});
