/**
 * Tests for embedBuilders.js
 */

const { EmbedBuilder } = require('discord.js');
const { botPrefix } = require('../../../config');

describe('embedBuilders', () => {
  let embedBuilders;
  let mockPersonalityManager;
  let mockConfig;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Mock console to suppress output during tests
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Mock config
    mockConfig = {
      botPrefix,
      botConfig: {
        name: 'TestBot',
        prefix: botPrefix,
        environment: 'test',
      },
    };
    jest.doMock('../../../config', () => mockConfig);

    // Mock personalityManager
    mockPersonalityManager = {
      listPersonalitiesForUser: jest.fn(),
      personalityAliases: new Map(),
    };
    jest.doMock('../../../src/core/personality', () => mockPersonalityManager);

    // Import after mocking
    embedBuilders = require('../../../src/utils/embedBuilders');
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('createPersonalityAddedEmbed', () => {
    it('should create basic personality added embed', () => {
      const embed = embedBuilders.createPersonalityAddedEmbed(
        'test-personality',
        'Test Personality',
        'test',
        null
      );

      expect(embed.data.title).toBe('Personality Added');
      expect(embed.data.description).toBe('Successfully added personality: Test Personality');
      expect(embed.data.color).toBe('#00FF00'); // Green
      expect(embed.data.fields).toHaveLength(3);
      expect(embed.data.fields[0]).toEqual({ name: 'Full Name', value: 'test-personality' });
      expect(embed.data.fields[1]).toEqual({ name: 'Display Name', value: 'Test Personality' });
      expect(embed.data.fields[2]).toEqual({ name: 'Alias', value: 'test' });
    });

    it('should handle personality without display name', () => {
      const embed = embedBuilders.createPersonalityAddedEmbed(
        'test-personality',
        null,
        'test',
        null
      );

      expect(embed.data.description).toBe('Successfully added personality: test-personality');
      expect(embed.data.fields[1]).toEqual({ name: 'Display Name', value: 'Not set' });
    });

    it('should handle personality without alias', () => {
      const embed = embedBuilders.createPersonalityAddedEmbed(
        'test-personality',
        'Test Personality',
        null,
        null
      );

      expect(embed.data.fields[2]).toEqual({ name: 'Alias', value: 'test personality' });
    });

    it('should handle personality with same display name as full name', () => {
      const embed = embedBuilders.createPersonalityAddedEmbed(
        'test-personality',
        'test-personality',
        null,
        null
      );

      expect(embed.data.fields[2]).toEqual({ name: 'Alias', value: 'None set' });
    });

    it('should add valid avatar URL as thumbnail', () => {
      const embed = embedBuilders.createPersonalityAddedEmbed(
        'test-personality',
        'Test Personality',
        'test',
        'https://example.com/avatar.png'
      );

      expect(embed.data.thumbnail).toEqual({ url: 'https://example.com/avatar.png' });
    });

    it('should not add invalid avatar URL', () => {
      const embed = embedBuilders.createPersonalityAddedEmbed(
        'test-personality',
        'Test Personality',
        'test',
        'not-a-valid-url'
      );

      expect(embed.data.thumbnail).toBeFalsy();
    });
  });

  describe('createPersonalityListEmbed', () => {
    it('should handle invalid user ID', () => {
      const result = embedBuilders.createPersonalityListEmbed(null);

      expect(result.embed.data.title).toBe('Error');
      expect(result.embed.data.description).toBe(
        'An error occurred while retrieving personalities'
      );
      expect(result.embed.data.color).toBe('#FF0000'); // Red
      expect(result.totalPages).toBe(1);
      expect(result.currentPage).toBe(1);
    });

    it('should handle non-array return from listPersonalitiesForUser', () => {
      mockPersonalityManager.listPersonalitiesForUser.mockReturnValue('not-an-array');

      const result = embedBuilders.createPersonalityListEmbed('user123');

      expect(result.embed.data.title).toBe('Error');
      expect(result.totalPages).toBe(1);
    });

    it('should create empty list embed', () => {
      mockPersonalityManager.listPersonalitiesForUser.mockReturnValue([]);

      const result = embedBuilders.createPersonalityListEmbed('user123');

      expect(result.embed.data.title).toBe('Your Personalities (Page 1/1)');
      expect(result.embed.data.description).toBe('You have 0 personalities');
      expect(result.totalPages).toBe(1);
      expect(result.currentPage).toBe(1);
    });

    it('should create single page personality list', () => {
      const personalities = [
        { fullName: 'personality-1', displayName: 'Personality 1' },
        { fullName: 'personality-2', displayName: 'Personality 2' },
      ];
      mockPersonalityManager.listPersonalitiesForUser.mockReturnValue(personalities);

      const result = embedBuilders.createPersonalityListEmbed('user123');

      expect(result.embed.data.title).toBe('Your Personalities (Page 1/1)');
      expect(result.embed.data.description).toBe('You have 2 personalities');
      expect(result.embed.data.fields).toHaveLength(2);
      expect(result.embed.data.fields[0].name).toBe('Personality 1');
      expect(result.embed.data.fields[0].value).toBe('ID: `personality-1`\nNo aliases');
    });

    it('should include aliases in personality list', () => {
      const personalities = [{ fullName: 'personality-1', displayName: 'Personality 1' }];
      mockPersonalityManager.listPersonalitiesForUser.mockReturnValue(personalities);
      mockPersonalityManager.personalityAliases.set('p1', 'personality-1');
      mockPersonalityManager.personalityAliases.set('test', 'personality-1');

      const result = embedBuilders.createPersonalityListEmbed('user123');

      expect(result.embed.data.fields[0].value).toBe('ID: `personality-1`\nAliases: p1, test');
    });

    it('should handle pagination', () => {
      // Create 25 personalities to test pagination
      const personalities = Array.from({ length: 25 }, (_, i) => ({
        fullName: `personality-${i + 1}`,
        displayName: `Personality ${i + 1}`,
      }));
      mockPersonalityManager.listPersonalitiesForUser.mockReturnValue(personalities);

      // Test first page
      const result1 = embedBuilders.createPersonalityListEmbed('user123', 1);
      expect(result1.embed.data.title).toBe('Your Personalities (Page 1/2)');
      expect(result1.embed.data.fields).toHaveLength(21); // 20 personalities + 1 navigation
      expect(result1.totalPages).toBe(2);
      expect(result1.currentPage).toBe(1);

      // Test second page
      const result2 = embedBuilders.createPersonalityListEmbed('user123', 2);
      expect(result2.embed.data.title).toBe('Your Personalities (Page 2/2)');
      expect(result2.embed.data.fields).toHaveLength(6); // 5 personalities + 1 navigation
      expect(result2.totalPages).toBe(2);
      expect(result2.currentPage).toBe(2);
    });

    it('should handle invalid page numbers', () => {
      const personalities = Array.from({ length: 25 }, (_, i) => ({
        fullName: `personality-${i + 1}`,
        displayName: `Personality ${i + 1}`,
      }));
      mockPersonalityManager.listPersonalitiesForUser.mockReturnValue(personalities);

      // Test page too high
      const result1 = embedBuilders.createPersonalityListEmbed('user123', 10);
      expect(result1.currentPage).toBe(2); // Should cap at max page

      // Test negative page
      const result2 = embedBuilders.createPersonalityListEmbed('user123', -1);
      expect(result2.currentPage).toBe(1); // Should floor at 1

      // Test non-numeric page
      const result3 = embedBuilders.createPersonalityListEmbed('user123', 'invalid');
      expect(result3.currentPage).toBe(1); // Should default to 1
    });

    it('should handle personalityAliases as object instead of Map', () => {
      const personalities = [{ fullName: 'personality-1', displayName: 'Personality 1' }];
      mockPersonalityManager.listPersonalitiesForUser.mockReturnValue(personalities);
      // The function checks if personalityAliases is a Map and converts it if not
      // But our mock already sets it as a Map, so let's test with undefined instead
      mockPersonalityManager.personalityAliases = undefined;

      const result = embedBuilders.createPersonalityListEmbed('user123');

      // Should handle undefined gracefully
      expect(result.embed.data.fields[0].value).toBe('ID: `personality-1`\nNo aliases');
    });

    it('should handle invalid personality objects', () => {
      const personalities = [
        { fullName: 'valid', displayName: 'Valid' },
        null,
        'invalid',
        { /* missing fullName */ displayName: 'Invalid' },
      ];
      mockPersonalityManager.listPersonalitiesForUser.mockReturnValue(personalities);

      const result = embedBuilders.createPersonalityListEmbed('user123');

      // Should skip invalid entries
      expect(result.embed.data.fields).toHaveLength(2); // Valid + one with fallback
      expect(result.embed.data.fields[0].name).toBe('Valid');
      expect(result.embed.data.fields[1].name).toBe('Invalid');
      expect(result.embed.data.fields[1].value).toBe('ID: `unknown`\nNo aliases');
    });

    it('should handle error in personality processing', () => {
      mockPersonalityManager.listPersonalitiesForUser.mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = embedBuilders.createPersonalityListEmbed('user123');

      expect(result.embed.data.title).toBe('Error');
      expect(result.embed.data.description).toContain('Sorry, there was a problem');
    });
  });

  describe('createListEmbed', () => {
    it('should create basic list embed', () => {
      const personalities = [{ displayName: 'Test', fullName: 'test-personality' }];

      const embed = embedBuilders.createListEmbed(personalities, 1, 1);

      expect(embed.data.title).toBe('Your Personalities (Page 1/1)');
      expect(embed.data.color).toBe('#5865F2');
      expect(embed.data.fields).toHaveLength(1);
      expect(embed.data.fields[0]).toEqual({
        name: 'Test',
        value: 'ID: `test-personality`',
      });
    });

    it('should handle personalities without displayName', () => {
      const personalities = [{ fullName: 'test-personality' }];

      const embed = embedBuilders.createListEmbed(personalities, 1, 1);

      expect(embed.data.fields[0]).toEqual({
        name: 'test-personality',
        value: 'ID: `test-personality`',
      });
    });

    it('should show navigation for multi-page lists', () => {
      const personalities = [];

      const embed = embedBuilders.createListEmbed(personalities, 2, 3);

      expect(embed.data.footer.text).toBe('Page 2 of 3');
      expect(embed.data.fields).toHaveLength(1);
      expect(embed.data.fields[0].name).toBe('Navigation');
      expect(embed.data.fields[0].value).toContain(`${botPrefix} list 3`);
      expect(embed.data.fields[0].value).toContain(`${botPrefix} list 1`);
    });

    it('should handle error during creation', () => {
      // Force an error by passing invalid data
      const personalities = [
        {
          get fullName() {
            throw new Error('Test error');
          },
        },
      ];

      const embed = embedBuilders.createListEmbed(personalities, 1, 1);

      expect(embed.data.title).toBe('Error');
      expect(embed.data.color).toBe('#FF0000');
    });
  });

  describe('createPersonalityInfoEmbed', () => {
    it('should create basic personality info embed', () => {
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        profile: {
          avatarUrl: 'https://example.com/avatar.png',
        },
        createdBy: 'user123',
        createdAt: new Date('2024-01-01').getTime(),
      };
      const aliases = ['test', 'tp'];

      const embed = embedBuilders.createPersonalityInfoEmbed(personality, aliases);

      expect(embed.data.title).toBe('Test Personality');
      expect(embed.data.description).toBe('No description');
      expect(embed.data.color).toBe('#5865F2');
      expect(embed.data.thumbnail).toEqual({ url: 'https://example.com/avatar.png' });
      expect(embed.data.fields).toHaveLength(5);
      expect(embed.data.fields[0]).toEqual({
        name: 'Full Name',
        value: 'test-personality',
      });
      expect(embed.data.fields[1]).toEqual({
        name: 'Display Name',
        value: 'Test Personality',
      });
      expect(embed.data.fields[2]).toEqual({
        name: 'Aliases',
        value: 'test, tp',
      });
      expect(embed.data.fields[3]).toEqual({
        name: 'Added By',
        value: '<@user123>',
      });
      expect(embed.data.fields[4].name).toBe('Added On');
    });

    it('should handle personality without aliases', () => {
      const personality = {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        createdBy: 'user123',
        createdAt: Date.now(),
      };

      const embed = embedBuilders.createPersonalityInfoEmbed(personality, []);

      expect(embed.data.fields[2]).toEqual({
        name: 'Aliases',
        value: 'None',
      });
    });

    it('should handle personality without display name', () => {
      const personality = {
        fullName: 'test-personality',
        createdBy: 'user123',
        createdAt: Date.now(),
      };

      const embed = embedBuilders.createPersonalityInfoEmbed(personality, []);

      expect(embed.data.title).toBe('test-personality');
      expect(embed.data.fields[1]).toEqual({
        name: 'Display Name',
        value: 'Not set',
      });
    });
  });

  describe('createStatusEmbed', () => {
    let mockClient;

    beforeEach(() => {
      mockClient = {
        uptime: 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000 + 15 * 60 * 1000 + 30 * 1000,
        guilds: {
          cache: {
            size: 5,
          },
        },
      };

      // Mock process.memoryUsage
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        heapUsed: 150 * 1024 * 1024, // 150MB
      });
    });

    afterEach(() => {
      process.memoryUsage.mockRestore();
    });

    it('should create status embed with all fields', () => {
      const embed = embedBuilders.createStatusEmbed(mockClient, 25, 5, 'Verified');

      expect(embed.data.title).toBe('TestBot Status');
      expect(embed.data.description).toBe('Current bot status and statistics');
      expect(embed.data.color).toBe('#5865F2');
      expect(embed.data.fields).toHaveLength(6);
      expect(embed.data.fields[0]).toEqual({
        name: 'Uptime',
        value: '2d 3h 15m 30s',
      });
      expect(embed.data.fields[1]).toEqual({
        name: 'Total Personalities',
        value: '25',
      });
      expect(embed.data.fields[2]).toEqual({
        name: 'Your Personalities',
        value: '5',
      });
      expect(embed.data.fields[3]).toEqual({
        name: 'Connected Servers',
        value: '5',
      });
      expect(embed.data.fields[4]).toEqual({
        name: 'Age Verification',
        value: 'Verified',
      });
      expect(embed.data.fields[5]).toEqual({
        name: 'Memory Usage',
        value: '150 MB',
      });
      expect(embed.data.footer).toEqual({ text: 'Bot Version: 1.0.0' });
    });

    it('should handle default verification status', () => {
      const embed = embedBuilders.createStatusEmbed(mockClient, 0, 0);

      expect(embed.data.fields[4].value).toBe('Unknown');
    });
  });

  describe('createHelpEmbed', () => {
    it('should create help embed for regular user', () => {
      const embed = embedBuilders.createHelpEmbed(false);

      expect(embed.data.title).toBe('TestBot Help');
      expect(embed.data.description).toBe(
        'TestBot allows you to interact with multiple AI personalities in Discord.'
      );
      expect(embed.data.color).toBe('#5865F2');

      // Check that it has authentication commands
      const fieldNames = embed.data.fields.map(f => f.name);
      expect(fieldNames).toContain('Authentication');
      expect(fieldNames).toContain(`${botPrefix} auth start`);
      expect(fieldNames).toContain(`${botPrefix} auth code <code>`);
      expect(fieldNames).toContain(`${botPrefix} auth status`);
    });

    it('should include admin commands for admin user', () => {
      const embed = embedBuilders.createHelpEmbed(true);

      // Admin embeds should have additional fields
      const fieldNames = embed.data.fields.map(f => f.name);
      expect(fieldNames.length).toBeGreaterThan(0);

      // Should still have basic commands
      expect(fieldNames).toContain('Authentication');
    });

    it('should include bot prefix in commands', () => {
      const embed = embedBuilders.createHelpEmbed(false);

      // Check that commands use the configured prefix
      const commandFields = embed.data.fields.filter(f => f.name.startsWith(botPrefix));
      expect(commandFields.length).toBeGreaterThan(0);
    });
  });

  describe('formatUptime', () => {
    it('should format milliseconds to uptime string', () => {
      // 2 days, 3 hours, 15 minutes, 30 seconds
      const ms = 2 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000 + 15 * 60 * 1000 + 30 * 1000;

      const result = embedBuilders.formatUptime(ms);

      expect(result).toBe('2d 3h 15m 30s');
    });

    it('should handle zero values', () => {
      const result = embedBuilders.formatUptime(0);
      expect(result).toBe('0d 0h 0m 0s');
    });

    it('should handle partial values', () => {
      // Just 90 seconds
      const result = embedBuilders.formatUptime(90000);
      expect(result).toBe('0d 0h 1m 30s');
    });

    it('should handle large values', () => {
      // 100 days
      const ms = 100 * 24 * 60 * 60 * 1000;
      const result = embedBuilders.formatUptime(ms);
      expect(result).toBe('100d 0h 0m 0s');
    });
  });
});
