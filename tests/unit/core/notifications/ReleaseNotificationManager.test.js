/**
 * Tests for ReleaseNotificationManager
 */

// Mock dependencies
jest.mock('discord.js', () => ({
  EmbedBuilder: jest.fn().mockImplementation(() => ({
    setColor: jest.fn().mockReturnThis(),
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    setTimestamp: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
  })),
}));

jest.mock('../../../../src/logger');

const { EmbedBuilder } = require('discord.js');
const ReleaseNotificationManager = require('../../../../src/core/notifications/ReleaseNotificationManager');
const logger = require('../../../../src/logger');

describe('ReleaseNotificationManager', () => {
  let manager;
  let mockClient;
  let mockVersionTracker;
  let mockPreferences;
  let mockGithubClient;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set up logger mock
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();
    
    // Mock Discord client
    mockClient = {
      users: {
        fetch: jest.fn(),
      },
    };
    
    // Mock version tracker
    mockVersionTracker = {
      checkForNewVersion: jest.fn(),
      saveNotifiedVersion: jest.fn(),
    };
    
    // Mock preferences
    mockPreferences = {
      load: jest.fn().mockResolvedValue(),
      getUsersToNotify: jest.fn(),
      recordNotification: jest.fn(),
      setOptOut: jest.fn(),
      getUserPreferences: jest.fn(),
      getStatistics: jest.fn(),
    };
    
    // Mock GitHub client
    mockGithubClient = {
      getReleaseByTag: jest.fn(),
      getReleasesBetween: jest.fn(),
      parseReleaseChanges: jest.fn(),
      owner: 'testowner',
      repo: 'testrepo',
    };
    
    manager = new ReleaseNotificationManager({
      client: mockClient,
      versionTracker: mockVersionTracker,
      preferences: mockPreferences,
      githubClient: mockGithubClient,
      delay: () => Promise.resolve(), // No delay in tests
    });
  });

  describe('initialize', () => {
    it('should initialize with provided client', async () => {
      await manager.initialize();

      expect(manager.initialized).toBe(true);
      expect(mockPreferences.load).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('[ReleaseNotificationManager] Initialized successfully');
    });

    it('should accept client in initialize method', async () => {
      const newClient = { users: { fetch: jest.fn() } };
      manager.client = null;

      await manager.initialize(newClient);

      expect(manager.client).toBe(newClient);
      expect(manager.initialized).toBe(true);
    });

    it('should throw error if no client provided', async () => {
      manager.client = null;

      await expect(manager.initialize()).rejects.toThrow('Discord client is required');
    });
  });

  describe('checkAndNotify', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should not notify if no new version', async () => {
      mockVersionTracker.checkForNewVersion.mockResolvedValue({
        hasNewVersion: false,
        currentVersion: '1.0.0',
        lastVersion: '1.0.0',
        changeType: null,
      });

      const result = await manager.checkAndNotify();

      expect(result).toEqual({
        notified: false,
        reason: 'No new version',
      });
      expect(mockGithubClient.getReleaseByTag).not.toHaveBeenCalled();
    });

    it('should not notify if GitHub release not found', async () => {
      mockVersionTracker.checkForNewVersion.mockResolvedValue({
        hasNewVersion: true,
        currentVersion: '1.1.0',
        lastVersion: '1.0.0',
        changeType: 'minor',
      });
      mockGithubClient.getReleasesBetween.mockResolvedValue([]);

      const result = await manager.checkAndNotify();

      expect(result).toEqual({
        notified: false,
        reason: 'No releases found on GitHub',
      });
    });

    it('should not notify if no users opted in for change type', async () => {
      mockVersionTracker.checkForNewVersion.mockResolvedValue({
        hasNewVersion: true,
        currentVersion: '1.0.1',
        lastVersion: '1.0.0',
        changeType: 'patch',
      });
      mockGithubClient.getReleasesBetween.mockResolvedValue([{ tag_name: 'v1.0.1' }]);
      mockPreferences.getUsersToNotify.mockReturnValue([]);

      const result = await manager.checkAndNotify();

      expect(result).toEqual({
        notified: false,
        reason: 'No users opted in for this change type',
      });
      expect(mockVersionTracker.saveNotifiedVersion).toHaveBeenCalledWith('1.0.1');
    });

    it('should send notifications to opted-in users', async () => {
      const mockReleases = [{
        tag_name: 'v1.1.0',
        name: 'Version 1.1.0',
        body: '## Features\n- New feature',
        html_url: 'https://example.com/test/test/releases/tag/v1.1.0',
        published_at: '2024-01-01T00:00:00Z',
      }];

      mockVersionTracker.checkForNewVersion.mockResolvedValue({
        hasNewVersion: true,
        currentVersion: '1.1.0',
        lastVersion: '1.0.0',
        changeType: 'minor',
      });
      mockGithubClient.getReleasesBetween.mockResolvedValue(mockReleases);
      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: ['New feature'],
        fixes: [],
        breaking: [],
        other: [],
      });
      mockPreferences.getUsersToNotify.mockReturnValue(['user123', 'user456']);
      mockPreferences.getUserPreferences.mockReturnValue({
        optedOut: false,
        notificationLevel: 'minor',
        lastNotified: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const mockUser1 = { send: jest.fn().mockResolvedValue() };
      const mockUser2 = { send: jest.fn().mockResolvedValue() };
      mockClient.users.fetch
        .mockResolvedValueOnce(mockUser1)
        .mockResolvedValueOnce(mockUser2);

      const result = await manager.checkAndNotify();

      expect(result).toEqual({
        notified: true,
        version: '1.1.0',
        changeType: 'minor',
        usersNotified: 2,
        usersFailed: 0,
      });

      expect(mockUser1.send).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
      expect(mockUser2.send).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
      expect(mockPreferences.recordNotification).toHaveBeenCalledTimes(2);
      expect(mockVersionTracker.saveNotifiedVersion).toHaveBeenCalledWith('1.1.0');
      expect(mockGithubClient.getReleasesBetween).toHaveBeenCalledWith('1.0.0', '1.1.0');
    });

    it('should handle notification failures gracefully', async () => {
      mockVersionTracker.checkForNewVersion.mockResolvedValue({
        hasNewVersion: true,
        currentVersion: '1.1.0',
        lastVersion: '1.0.0',
        changeType: 'minor',
      });
      mockGithubClient.getReleasesBetween.mockResolvedValue([{ 
        tag_name: 'v1.1.0',
        published_at: '2024-01-01T00:00:00Z',
        html_url: 'https://example.com/releases/v1.1.0'
      }]);
      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: [],
        fixes: [],
        breaking: [],
        other: [],
      });
      mockPreferences.getUsersToNotify.mockReturnValue(['user123', 'user456']);
      mockPreferences.getUserPreferences.mockReturnValue({
        optedOut: false,
        notificationLevel: 'minor',
        lastNotified: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const mockUser1 = { send: jest.fn().mockResolvedValue() };
      const mockUser2 = { send: jest.fn().mockRejectedValue(new Error('DMs disabled')) };
      mockClient.users.fetch
        .mockResolvedValueOnce(mockUser1)
        .mockResolvedValueOnce(mockUser2);

      const result = await manager.checkAndNotify();

      expect(result).toEqual({
        notified: true,
        version: '1.1.0',
        changeType: 'minor',
        usersNotified: 1,
        usersFailed: 1,
      });
    });

    it('should throw error if not initialized', async () => {
      manager.initialized = false;

      await expect(manager.checkAndNotify()).rejects.toThrow('ReleaseNotificationManager not initialized');
    });
  });

  describe('sendDMToUser', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should send DM to user', async () => {
      const mockUser = { send: jest.fn().mockResolvedValue() };
      mockClient.users.fetch.mockResolvedValue(mockUser);
      const mockEmbed = {};

      await manager.sendDMToUser('user123', mockEmbed);

      expect(mockClient.users.fetch).toHaveBeenCalledWith('user123');
      expect(mockUser.send).toHaveBeenCalledWith({ embeds: [mockEmbed] });
    });

    it('should handle user not found', async () => {
      mockClient.users.fetch.mockResolvedValue(null);

      await expect(manager.sendDMToUser('user123', {}))
        .rejects.toThrow('User not found');
    });

    it('should auto opt-out users with DMs disabled', async () => {
      const error = new Error('Cannot send messages to this user');
      error.code = 50007;
      const mockUser = { send: jest.fn().mockRejectedValue(error) };
      mockClient.users.fetch.mockResolvedValue(mockUser);

      await expect(manager.sendDMToUser('user123', {}))
        .rejects.toThrow(error);

      expect(mockPreferences.setOptOut).toHaveBeenCalledWith('user123', true);
      expect(logger.info).toHaveBeenCalledWith(
        '[ReleaseNotificationManager] User user123 has DMs disabled, marking as opted out'
      );
    });
  });

  describe('createReleaseEmbed', () => {
    const mockRelease = {
      tag_name: 'v1.1.0',
      published_at: '2024-01-01T00:00:00Z',
      html_url: 'https://example.com/test/test/releases/tag/v1.1.0',
    };

    it('should create embed with first notification message', () => {
      mockPreferences.getUserPreferences.mockReturnValue({
        updatedAt: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        lastNotified: null,
      });
      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: [],
        fixes: [],
        breaking: [],
        other: [],
      });

      const embed = manager.createReleaseEmbed(
        { currentVersion: '1.1.0', changeType: 'minor' },
        [mockRelease],
        'user123'
      );

      expect(EmbedBuilder).toHaveBeenCalled();
      const mockEmbed = EmbedBuilder.mock.results[0].value;
      expect(mockEmbed.setFooter).toHaveBeenCalledWith({
        text: '📌 First time receiving this? You\'re automatically opted in. Use !tz notifications off to opt out.',
      });
    });

    it('should create embed with implied consent message', () => {
      mockPreferences.getUserPreferences.mockReturnValue({
        updatedAt: '2024-01-01T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        lastNotified: '1.0.0',
      });
      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: [],
        fixes: [],
        breaking: [],
        other: [],
      });

      const embed = manager.createReleaseEmbed(
        { currentVersion: '1.1.0', changeType: 'minor' },
        [mockRelease],
        'user123'
      );

      const mockEmbed = EmbedBuilder.mock.results[0].value;
      expect(mockEmbed.setFooter).toHaveBeenCalledWith({
        text: '✅ You\'re receiving these because you haven\'t opted out. Use !tz notifications off to stop.',
      });
    });

    it('should create embed with standard message for users who interacted', () => {
      mockPreferences.getUserPreferences.mockReturnValue({
        updatedAt: '2024-01-02T00:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
        lastNotified: '1.0.0',
      });
      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: [],
        fixes: [],
        breaking: [],
        other: [],
      });

      const embed = manager.createReleaseEmbed(
        { currentVersion: '1.1.0', changeType: 'minor' },
        [mockRelease],
        'user123'
      );

      const mockEmbed = EmbedBuilder.mock.results[0].value;
      expect(mockEmbed.setFooter).toHaveBeenCalledWith({
        text: 'You can change your notification preferences with !tz notifications',
      });
    });

    it('should add version comparison when lastVersion exists', () => {
      mockPreferences.getUserPreferences.mockReturnValue({});
      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: [],
        fixes: [],
        breaking: [],
        other: [],
      });

      const embed = manager.createReleaseEmbed(
        { currentVersion: '1.1.0', lastVersion: '1.0.0', changeType: 'minor' },
        [mockRelease],
        'user123'
      );

      const mockEmbed = EmbedBuilder.mock.results[0].value;
      expect(mockEmbed.addFields).toHaveBeenCalledWith({
        name: 'Version Update',
        value: '1.0.0 → 1.1.0',
        inline: true,
      });
    });

    it('should add categorized changes', () => {
      mockPreferences.getUserPreferences.mockReturnValue({});
      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: ['Feature 1', 'Feature 2'],
        fixes: ['Fix 1'],
        breaking: ['Breaking change'],
        other: [],
      });

      const embed = manager.createReleaseEmbed(
        { currentVersion: '2.0.0', changeType: 'major' },
        [mockRelease],
        'user123'
      );

      const mockEmbed = EmbedBuilder.mock.results[0].value;
      expect(mockEmbed.addFields).toHaveBeenCalledWith({
        name: '⚠️ Breaking Changes',
        value: '• Breaking change',
        inline: false,
      });
      expect(mockEmbed.addFields).toHaveBeenCalledWith({
        name: '✨ New Features',
        value: '• Feature 1\n• Feature 2',
        inline: false,
      });
      expect(mockEmbed.addFields).toHaveBeenCalledWith({
        name: '🐛 Bug Fixes',
        value: '• Fix 1',
        inline: false,
      });
    });

    it('should truncate long change lists', () => {
      mockPreferences.getUserPreferences.mockReturnValue({});
      const manyChanges = Array(10).fill('Change');
      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: manyChanges,
        fixes: [],
        breaking: [],
        other: [],
      });

      const embed = manager.createReleaseEmbed(
        { currentVersion: '1.1.0', changeType: 'minor' },
        [mockRelease],
        'user123'
      );

      const mockEmbed = EmbedBuilder.mock.results[0].value;
      const fieldsCall = mockEmbed.addFields.mock.calls.find(
        call => call[0].name === '✨ New Features'
      );
      expect(fieldsCall[0].value).toContain('...and 5 more');
    });
  });

  describe('getColorForChangeType', () => {
    it('should return correct colors', () => {
      expect(manager.getColorForChangeType('major')).toBe(0xFF0000); // Red
      expect(manager.getColorForChangeType('minor')).toBe(0x00FF00); // Green
      expect(manager.getColorForChangeType('patch')).toBe(0x0099FF); // Blue
      expect(manager.getColorForChangeType('unknown')).toBe(0x808080); // Gray
    });
  });

  describe('getChangeTypeDescription', () => {
    it('should return correct descriptions', () => {
      expect(manager.getChangeTypeDescription('major'))
        .toBe('This is a major release with significant changes and new features!');
      expect(manager.getChangeTypeDescription('minor'))
        .toBe('This release includes new features and improvements.');
      expect(manager.getChangeTypeDescription('patch'))
        .toBe('This release includes bug fixes and minor improvements.');
      expect(manager.getChangeTypeDescription('unknown'))
        .toBe('A new version has been released.');
    });
  });

  describe('getStatistics', () => {
    it('should return statistics from preferences', () => {
      const mockStats = {
        total: 10,
        optedOut: 2,
        byLevel: { major: 3, minor: 5, patch: 2, none: 0 },
      };
      mockPreferences.getStatistics.mockReturnValue(mockStats);

      const stats = manager.getStatistics();

      expect(stats).toEqual(mockStats);
      expect(mockPreferences.getStatistics).toHaveBeenCalled();
    });
  });

  describe('Multi-release functionality', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should fetch multiple releases when versions have changed', async () => {
      mockVersionTracker.checkForNewVersion.mockResolvedValue({
        hasNewVersion: true,
        currentVersion: '1.3.0',
        lastVersion: '1.0.0',
        changeType: 'minor',
      });

      const mockReleases = [
        { tag_name: 'v1.3.0', published_at: '2024-01-03T00:00:00Z' },
        { tag_name: 'v1.2.0', published_at: '2024-01-02T00:00:00Z' },
        { tag_name: 'v1.1.0', published_at: '2024-01-01T00:00:00Z' },
      ];

      mockGithubClient.getReleasesBetween.mockResolvedValue(mockReleases);
      mockPreferences.getUsersToNotify.mockReturnValue(['user123']);
      mockClient.users.fetch.mockResolvedValue({ send: jest.fn().mockResolvedValue() });

      const result = await manager.checkAndNotify();

      expect(mockGithubClient.getReleasesBetween).toHaveBeenCalledWith('1.0.0', '1.3.0');
      expect(result.notified).toBe(true);
    });

    it('should create embed with multiple releases', () => {
      const mockReleases = [
        { 
          tag_name: 'v1.3.0', 
          published_at: '2024-01-03T00:00:00Z',
          html_url: 'https://example.com/releases/v1.3.0'
        },
        { 
          tag_name: 'v1.2.0', 
          published_at: '2024-01-02T00:00:00Z',
          html_url: 'https://example.com/releases/v1.2.0'
        },
        { 
          tag_name: 'v1.1.0', 
          published_at: '2024-01-01T00:00:00Z',
          html_url: 'https://example.com/releases/v1.1.0'
        },
      ];

      mockPreferences.getUserPreferences.mockReturnValue({});
      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: ['Feature A'],
        fixes: ['Bug fix 1'],
        breaking: [],
        other: [],
      });

      const embed = manager.createReleaseEmbed(
        { currentVersion: '1.3.0', lastVersion: '1.0.0', changeType: 'minor' },
        mockReleases,
        'user123'
      );

      const mockEmbed = EmbedBuilder.mock.results[0].value;
      expect(mockEmbed.setTitle).toHaveBeenCalledWith(
        '🚀 Tzurot Multiple Releases (3 versions)'
      );
      expect(mockEmbed.addFields).toHaveBeenCalledWith(
        expect.objectContaining({
          name: '📋 Included Versions',
          value: expect.stringContaining('v1.3.0'),
        })
      );
    });

    it('should aggregate changes from multiple releases', () => {
      const mockReleases = [
        { tag_name: 'v1.2.0', published_at: '2024-01-02T00:00:00Z' },
        { tag_name: 'v1.1.0', published_at: '2024-01-01T00:00:00Z' },
      ];

      mockGithubClient.parseReleaseChanges
        .mockReturnValueOnce({
          features: ['Feature B'],
          fixes: ['Bug fix 2'],
          breaking: ['Breaking change 1'],
          other: [],
        })
        .mockReturnValueOnce({
          features: ['Feature A'],
          fixes: ['Bug fix 1'],
          breaking: [],
          other: [],
        });

      const aggregated = manager.aggregateReleaseChanges(mockReleases);

      expect(aggregated.features).toEqual(['[v1.2.0] Feature B', '[v1.1.0] Feature A']);
      expect(aggregated.fixes).toEqual(['[v1.2.0] Bug fix 2', '[v1.1.0] Bug fix 1']);
      expect(aggregated.breaking).toEqual(['[v1.2.0] Breaking change 1']);
    });

    it('should generate proper description for multiple releases', () => {
      const mockReleases = [
        { tag_name: 'v1.3.0', published_at: '2024-01-03T00:00:00Z' },
        { tag_name: 'v1.1.0', published_at: '2024-01-01T00:00:00Z' },
      ];

      const description = manager.getMultiReleaseDescription(
        { changeType: 'minor' },
        mockReleases
      );

      expect(description).toContain('You\'ve missed 2 releases');
      expect(description).toContain('over the past 2 days');
    });

    it('should handle single release in multi-release flow', () => {
      const mockReleases = [
        { tag_name: 'v1.1.0', published_at: '2024-01-01T00:00:00Z' },
      ];

      mockGithubClient.parseReleaseChanges.mockReturnValue({
        features: ['Feature A'],
        fixes: [],
        breaking: [],
        other: [],
      });

      const aggregated = manager.aggregateReleaseChanges(mockReleases);

      // Single release shouldn't have version prefix
      expect(aggregated.features).toEqual(['Feature A']);
    });
  });
});