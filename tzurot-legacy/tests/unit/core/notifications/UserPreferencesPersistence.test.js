/**
 * Tests for UserPreferencesPersistence
 */

// Mock dependencies
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    mkdir: jest.fn(),
  },
}));

jest.mock('../../../../src/logger');

const fs = require('fs').promises;
const UserPreferencesPersistence = require('../../../../src/core/notifications/UserPreferencesPersistence');
const logger = require('../../../../src/logger');

describe('UserPreferencesPersistence', () => {
  let persistence;
  let mockScheduler;
  let mockClearScheduler;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock timer functions
    mockScheduler = jest.fn((fn, delay) => setTimeout(fn, delay));
    mockClearScheduler = jest.fn(timer => clearTimeout(timer));

    persistence = new UserPreferencesPersistence({
      scheduler: mockScheduler,
      clearScheduler: mockClearScheduler,
      saveDebounceDelay: 100, // Short delay for tests
    });

    // Set up logger mock
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('load', () => {
    it('should load preferences from file', async () => {
      const mockData = {
        user123: {
          optedOut: true,
          notificationLevel: 'major',
          lastNotified: '1.0.0',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        user456: {
          optedOut: false,
          notificationLevel: 'minor',
          lastNotified: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      };

      fs.readFile.mockResolvedValue(JSON.stringify(mockData));

      await persistence.load();

      expect(persistence.preferences.size).toBe(2);
      expect(persistence.preferences.get('user123')).toEqual(mockData.user123);
      expect(persistence.preferences.get('user456')).toEqual(mockData.user456);
      expect(logger.info).toHaveBeenCalledWith(
        '[UserPreferencesPersistence] Loaded 2 user preferences'
      );
    });

    it('should start fresh if file does not exist', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.readFile.mockRejectedValue(error);

      await persistence.load();

      expect(persistence.preferences.size).toBe(0);
      expect(logger.info).toHaveBeenCalledWith(
        '[UserPreferencesPersistence] No preferences file found, starting fresh'
      );
    });

    it('should throw error for other file read errors', async () => {
      fs.readFile.mockRejectedValue(new Error('Permission denied'));

      await expect(persistence.load()).rejects.toThrow('Permission denied');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error loading preferences')
      );
    });
  });

  describe('getUserPreferences', () => {
    it('should return default preferences for new user', () => {
      const prefs = persistence.getUserPreferences('newuser');

      expect(prefs).toMatchObject({
        optedOut: false,
        notificationLevel: 'minor',
        lastNotified: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(prefs.createdAt).toBe(prefs.updatedAt);
    });

    it('should return stored preferences for existing user', () => {
      const storedPrefs = {
        optedOut: true,
        notificationLevel: 'major',
        lastNotified: '1.0.0',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      };
      persistence.preferences.set('user123', storedPrefs);

      const prefs = persistence.getUserPreferences('user123');

      expect(prefs).toEqual(storedPrefs);
    });

    it('should merge defaults with partial stored preferences', () => {
      const partialPrefs = {
        optedOut: true,
        // Missing other fields
      };
      persistence.preferences.set('user123', partialPrefs);

      const prefs = persistence.getUserPreferences('user123');

      expect(prefs).toMatchObject({
        optedOut: true,
        notificationLevel: 'minor', // Default
        lastNotified: null, // Default
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
    });
  });

  describe('updateUserPreferences', () => {
    it('should update preferences and trigger save', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const updated = await persistence.updateUserPreferences('user123', {
        optedOut: true,
        notificationLevel: 'major',
      });

      expect(updated).toMatchObject({
        optedOut: true,
        notificationLevel: 'major',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(persistence.preferences.get('user123')).toEqual(updated);
      expect(mockScheduler).toHaveBeenCalled();
    });

    it('should preserve createdAt when updating existing user', async () => {
      const existingPrefs = {
        optedOut: false,
        notificationLevel: 'minor',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      };
      persistence.preferences.set('user123', existingPrefs);

      const updated = await persistence.updateUserPreferences('user123', {
        optedOut: true,
      });

      expect(updated.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(updated.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('save (debounced)', () => {
    it('should debounce multiple save calls', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      // Make multiple save calls
      await persistence.save();
      await persistence.save();
      await persistence.save();

      // Should have scheduled only once (last call)
      expect(mockScheduler).toHaveBeenCalledTimes(3);
      expect(mockClearScheduler).toHaveBeenCalledTimes(2); // Clear previous timers

      // Advance timers to trigger save
      jest.runAllTimers();

      // Wait for async save to complete
      await Promise.resolve();

      expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });

    it('should save preferences to file', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      persistence.preferences.set('user123', {
        optedOut: true,
        notificationLevel: 'major',
      });

      await persistence.save();
      jest.runAllTimers();
      await Promise.resolve();

      expect(fs.mkdir).toHaveBeenCalledWith(expect.any(String), { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('releaseNotificationPreferences.json'),
        expect.stringContaining('"user123"')
      );
    });
  });

  describe('forceSave', () => {
    it('should save immediately without debouncing', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      persistence.preferences.set('user123', {
        optedOut: true,
      });

      await persistence.forceSave();

      // Should save immediately
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(mockClearScheduler).not.toHaveBeenCalled(); // No timer to clear
    });

    it('should cancel pending debounced save', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      // Schedule a debounced save
      await persistence.save();
      expect(mockScheduler).toHaveBeenCalled();

      // Force save should cancel the pending one
      await persistence.forceSave();
      expect(mockClearScheduler).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('setOptOut', () => {
    it('should set opt-out status', async () => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();

      const result = await persistence.setOptOut('user123', true);

      expect(result.optedOut).toBe(true);
      expect(persistence.preferences.get('user123').optedOut).toBe(true);
    });

    it('should allow opting back in', async () => {
      persistence.preferences.set('user123', { optedOut: true });

      const result = await persistence.setOptOut('user123', false);

      expect(result.optedOut).toBe(false);
    });
  });

  describe('setNotificationLevel', () => {
    it('should set valid notification levels', async () => {
      const validLevels = ['major', 'minor', 'patch', 'none'];

      for (const level of validLevels) {
        const result = await persistence.setNotificationLevel('user123', level);
        expect(result.notificationLevel).toBe(level);
      }
    });

    it('should reject invalid notification levels', async () => {
      await expect(persistence.setNotificationLevel('user123', 'invalid')).rejects.toThrow(
        'Invalid notification level: invalid'
      );
    });
  });

  describe('recordNotification', () => {
    it('should record last notified version', async () => {
      const result = await persistence.recordNotification('user123', '1.2.0');

      expect(result.lastNotified).toBe('1.2.0');
      expect(persistence.preferences.get('user123').lastNotified).toBe('1.2.0');
    });
  });

  describe('getUsersToNotify', () => {
    beforeEach(() => {
      // Set up test users with different preferences
      persistence.preferences.set('major-only', {
        optedOut: false,
        notificationLevel: 'major',
      });
      persistence.preferences.set('minor-user', {
        optedOut: false,
        notificationLevel: 'minor',
      });
      persistence.preferences.set('patch-user', {
        optedOut: false,
        notificationLevel: 'patch',
      });
      persistence.preferences.set('opted-out', {
        optedOut: true,
        notificationLevel: 'minor',
      });
      persistence.preferences.set('none-level', {
        optedOut: false,
        notificationLevel: 'none',
      });
    });

    it('should return users for major changes', () => {
      const users = persistence.getUsersToNotify('major');
      expect(users).toEqual(expect.arrayContaining(['major-only', 'minor-user', 'patch-user']));
      expect(users).not.toContain('opted-out');
      expect(users).not.toContain('none-level');
    });

    it('should return users for minor changes', () => {
      const users = persistence.getUsersToNotify('minor');
      expect(users).toEqual(expect.arrayContaining(['minor-user', 'patch-user']));
      expect(users).not.toContain('major-only');
      expect(users).not.toContain('opted-out');
      expect(users).not.toContain('none-level');
    });

    it('should return users for patch changes', () => {
      const users = persistence.getUsersToNotify('patch');
      expect(users).toEqual(['patch-user']);
      expect(users).not.toContain('major-only');
      expect(users).not.toContain('minor-user');
    });

    it('should handle users with default notification level', () => {
      persistence.preferences.set('default-user', {
        optedOut: false,
        // No notificationLevel set
      });

      const users = persistence.getUsersToNotify('minor');
      expect(users).toContain('default-user'); // Should default to minor
    });
  });

  describe('getStatistics', () => {
    it('should return correct statistics', () => {
      persistence.preferences.set('user1', {
        optedOut: true,
        notificationLevel: 'major',
      });
      persistence.preferences.set('user2', {
        optedOut: false,
        notificationLevel: 'minor',
      });
      persistence.preferences.set('user3', {
        optedOut: false,
        notificationLevel: 'minor',
      });
      persistence.preferences.set('user4', {
        optedOut: false,
        notificationLevel: 'patch',
      });
      persistence.preferences.set('user5', {
        optedOut: true,
        notificationLevel: 'none',
      });

      const stats = persistence.getStatistics();

      expect(stats).toEqual({
        total: 5,
        optedOut: 2,
        byLevel: {
          major: 1,
          minor: 2,
          patch: 1,
          none: 1,
        },
      });
    });

    it('should handle empty preferences', () => {
      const stats = persistence.getStatistics();

      expect(stats).toEqual({
        total: 0,
        optedOut: 0,
        byLevel: {
          major: 0,
          minor: 0,
          patch: 0,
          none: 0,
        },
      });
    });
  });

  describe('hasAnyUserBeenNotified', () => {
    it('should return false when no users have been notified', () => {
      persistence.preferences.set('user1', { optedOut: false });
      persistence.preferences.set('user2', { optedOut: true });

      expect(persistence.hasAnyUserBeenNotified()).toBe(false);
    });

    it('should return true when at least one user has been notified', () => {
      persistence.preferences.set('user1', { optedOut: false });
      persistence.preferences.set('user2', { optedOut: false, lastNotified: '1.0.0' });
      persistence.preferences.set('user3', { optedOut: true });

      expect(persistence.hasAnyUserBeenNotified()).toBe(true);
    });

    it('should return false for empty preferences', () => {
      expect(persistence.hasAnyUserBeenNotified()).toBe(false);
    });
  });
});
