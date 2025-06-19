// Mock dependencies before requiring the module
jest.mock('discord.js');
jest.mock('../../../../src/logger');
jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
    readFile: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
  },
}));
jest.mock('path');

// Import config to get the actual bot prefix
const { botPrefix } = require('../../../../config');

jest.mock('../../../../src/commands/utils/commandValidator', () => {
  return {
    createDirectSend: jest.fn().mockImplementation(message => {
      return async content => {
        return message.channel.send(content);
      };
    }),
  };
});

// Use enhanced test utilities
const { createMigrationHelper } = require('../../../utils/testEnhancements');

// Import mocked modules
const logger = require('../../../../src/logger');
const fs = require('fs').promises;
const path = require('path');

// Get migration helper for enhanced patterns
const migrationHelper = createMigrationHelper('command');

describe('VolumeTest Command', () => {
  let volumetestCommand;
  let mockMessage;
  const mockBotOwnerId = 'bot-owner-123';
  const mockUserId = 'user-123';

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set up environment
    process.env.BOT_OWNER_ID = mockBotOwnerId;

    // Mock process.cwd with a generic test directory
    jest.spyOn(process, 'cwd').mockReturnValue('/test/project');

    // Mock path.join and path.resolve
    path.join.mockImplementation((...args) => args.join('/'));
    path.resolve.mockImplementation(p => (p.startsWith('/') ? p : `/test/project/${p}`));

    // Create enhanced mock message
    mockMessage = migrationHelper.enhanced.createMessage({
      content: `${botPrefix} volumetest`,
      author: { id: mockUserId, username: 'testuser' },
    });

    // Mock reply method for embed responses
    mockMessage.reply = jest.fn().mockResolvedValue({
      id: 'reply-message-123',
    });

    // Import command module after mock setup
    volumetestCommand = require('../../../../src/commands/handlers/volumetest');
  });

  afterEach(() => {
    // Clean up environment
    delete process.env.BOT_OWNER_ID;
    delete process.env.RAILWAY_ENVIRONMENT;
  });

  it('should have the correct metadata', () => {
    expect(volumetestCommand.meta).toEqual({
      name: 'volumetest',
      description: 'Test if persistent volume is working (bot owner only)',
      usage: 'volumetest',
    });
  });

  it('should reject non-bot-owner users', async () => {
    await volumetestCommand.execute(mockMessage, [], {});

    expect(mockMessage.reply).toHaveBeenCalledWith('This command is restricted to the bot owner.');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('should work for bot owner in local environment', async () => {
    // Set up as bot owner
    mockMessage.author.id = mockBotOwnerId;

    // Mock file system operations
    const mockTestContent =
      'Volume test at 2025-01-01T00:00:00.000Z\nVolume test at 2025-01-01T00:01:00.000Z\n';
    fs.writeFile.mockResolvedValue();
    fs.readFile.mockResolvedValue(mockTestContent);
    fs.stat.mockResolvedValue({ isDirectory: () => true });
    fs.readdir.mockResolvedValue(['personalities.json', 'aliases.json', 'volume_test.txt']);

    await volumetestCommand.execute(mockMessage, [], {});

    // Verify file operations
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('volume_test.txt'),
      expect.stringContaining('Volume test at'),
      { flag: 'a' }
    );
    expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('volume_test.txt'), 'utf8');

    // Verify embed response
    expect(mockMessage.reply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          title: '📁 Persistent Volume Test',
          color: 0x00ff00,
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'Environment',
              value: 'Local',
            }),
            expect.objectContaining({
              name: 'Files Found',
              value: '3',
            }),
            expect.objectContaining({
              name: 'Test Writes',
              value: '2',
            }),
            expect.objectContaining({
              name: 'Persistence Check',
              value: expect.stringContaining('✅ Working! Found 2 entries'),
            }),
            expect.objectContaining({
              name: 'Debug: Your ID',
              value: mockBotOwnerId,
            }),
            expect.objectContaining({
              name: 'Debug: Bot Owner ID',
              value: mockBotOwnerId,
            }),
          ]),
        }),
      ],
    });
  });

  it('should work for bot owner in Railway environment', async () => {
    // Set up as bot owner in Railway
    mockMessage.author.id = mockBotOwnerId;
    process.env.RAILWAY_ENVIRONMENT = 'production';

    // Mock file system operations
    fs.writeFile.mockResolvedValue();
    fs.readFile.mockResolvedValue('Volume test at 2025-01-01T00:00:00.000Z\n');
    fs.stat.mockResolvedValue({ isDirectory: () => true });
    fs.readdir.mockResolvedValue(['personalities.json']);

    await volumetestCommand.execute(mockMessage, [], {});

    // Verify it uses Railway path
    expect(fs.writeFile).toHaveBeenCalledWith('/app/data/volume_test.txt', expect.any(String), {
      flag: 'a',
    });

    // Verify Railway environment in response
    expect(mockMessage.reply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'Environment',
              value: 'Railway (production)',
            }),
          ]),
        }),
      ],
    });
  });

  it('should handle file system errors gracefully', async () => {
    // Set up as bot owner
    mockMessage.author.id = mockBotOwnerId;

    // Mock file system error
    const fsError = new Error('Permission denied');
    fs.writeFile.mockRejectedValue(fsError);

    await volumetestCommand.execute(mockMessage, [], {});

    expect(logger.error).toHaveBeenCalledWith('[VolumeTest] Error testing volume:', fsError);
    expect(mockMessage.reply).toHaveBeenCalledWith('❌ Volume test failed: Permission denied');
  });

  it('should show first run message when only one entry exists', async () => {
    // Set up as bot owner
    mockMessage.author.id = mockBotOwnerId;

    // Mock single entry
    fs.writeFile.mockResolvedValue();
    fs.readFile.mockResolvedValue('Volume test at 2025-01-01T00:00:00.000Z\n');
    fs.stat.mockResolvedValue({ isDirectory: () => true });
    fs.readdir.mockResolvedValue([]);

    await volumetestCommand.execute(mockMessage, [], {});

    expect(mockMessage.reply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'Persistence Check',
              value: '⚠️ First run - redeploy to verify persistence',
            }),
          ]),
        }),
      ],
    });
  });

  it('should handle missing BOT_OWNER_ID environment variable', async () => {
    // Remove BOT_OWNER_ID
    delete process.env.BOT_OWNER_ID;

    await volumetestCommand.execute(mockMessage, [], {});

    // Should reject since undefined !== user ID
    expect(mockMessage.reply).toHaveBeenCalledWith('This command is restricted to the bot owner.');

    // Should show "Not set" in debug field if somehow executed
    expect(mockMessage.reply).not.toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'Debug: Bot Owner ID',
              value: 'Not set',
            }),
          ]),
        }),
      ],
    });
  });
});
