/**
 * Tests for VolumeTestCommand
 */

const {
  createVolumeTestCommand,
} = require('../../../../../src/application/commands/utility/VolumeTestCommand');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const logger = require('../../../../../src/logger');

// Mock logger
jest.mock('../../../../../src/logger');

describe('VolumeTestCommand', () => {
  let mockFs;
  let mockPath;
  let mockProcess;
  let migrationHelper;

  beforeEach(() => {
    // Clear mocks
    jest.clearAllMocks();

    migrationHelper = createMigrationHelper();
    // Mock file system
    mockFs = {
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      readFile: jest.fn().mockResolvedValue('Volume test at 2024-01-01T00:00:00.000Z\n'),
      stat: jest.fn().mockResolvedValue({
        isDirectory: () => true,
      }),
      readdir: jest.fn().mockResolvedValue(['personalities.json', 'volume_test.txt']),
    };

    // Mock path module
    mockPath = {
      join: jest.fn((...parts) => parts.join('/')),
      resolve: jest.fn(p => `/absolute/${p}`),
    };

    // Mock process
    mockProcess = {
      env: {
        BOT_OWNER_ID: 'owner123',
        NODE_ENV: 'test',
      },
      cwd: jest.fn().mockReturnValue('/home/test'),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Command Creation', () => {
    it('should create command with correct metadata', () => {
      const command = createVolumeTestCommand();

      expect(command.name).toBe('volumetest');
      expect(command.description).toBe('Test if persistent volume is working (bot owner only)');
      expect(command.category).toBe('Utility');
      expect(command.aliases).toEqual([]);
      expect(command.permissions).toEqual(['OWNER']);
      expect(command.options).toEqual([]);
      expect(command.ownerOnly).toBe(true);
    });
  });

  describe('Execute - Authorization', () => {
    it('should reject if bot owner ID is not configured', async () => {
      const command = createVolumeTestCommand({
        process: { env: {} },
      });

      const context = {
        userId: 'user123',
        channelId: 'channel123',
        guildId: 'guild123',
        commandPrefix: '!tz',
        isDM: false,
        args: [],
        options: {},
        respond: jest.fn().mockResolvedValue(undefined),
      };

      await command.execute(context);

      expect(context.respond).toHaveBeenCalledWith('Bot owner ID is not configured.');
    });

    it('should reject non-owner users', async () => {
      const command = createVolumeTestCommand({
        process: mockProcess,
      });

      const context = {
        userId: 'notowner123',
        channelId: 'channel123',
        guildId: 'guild123',
        commandPrefix: '!tz',
        isDM: false,
        args: [],
        options: {},
        respond: jest.fn().mockResolvedValue(undefined),
      };

      await command.execute(context);

      expect(context.respond).toHaveBeenCalledWith('This command is restricted to the bot owner.');
    });
  });

  describe('Execute - Volume Testing', () => {
    it('should test volume successfully for local environment', async () => {
      const command = createVolumeTestCommand({
        fs: mockFs,
        path: mockPath,
        process: mockProcess,
      });

      const context = {
        userId: 'owner123',
        channelId: 'channel123',
        guildId: 'guild123',
        commandPrefix: '!tz',
        isDM: false,
        args: [],
        options: {},
        respond: jest.fn().mockResolvedValue(undefined),
        respondWithEmbed: jest.fn().mockResolvedValue(undefined),
      };

      await command.execute(context);

      // Verify directory creation
      expect(mockFs.mkdir).toHaveBeenCalledWith('/home/test/data', { recursive: true });

      // Verify file write
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/home/test/data/volume_test.txt',
        expect.stringContaining('Volume test at'),
        { flag: 'a' }
      );

      // Verify file read operations
      expect(mockFs.readFile).toHaveBeenCalledWith('/home/test/data/volume_test.txt', 'utf8');
      expect(mockFs.stat).toHaveBeenCalledWith('/home/test/data');
      expect(mockFs.readdir).toHaveBeenCalledWith('/home/test/data');

      // Verify embed response
      expect(context.respondWithEmbed).toHaveBeenCalledWith({
        title: '📁 Persistent Volume Test',
        color: 0x00ff00,
        fields: expect.arrayContaining([
          expect.objectContaining({
            name: 'Environment',
            value: 'Local',
            inline: true,
          }),
          expect.objectContaining({
            name: 'NODE_ENV',
            value: 'test',
            inline: true,
          }),
          expect.objectContaining({
            name: 'Data Directory',
            value: '`/absolute//home/test/data`',
            inline: false,
          }),
          expect.objectContaining({
            name: 'Directory Status',
            value: '✅ Exists',
            inline: true,
          }),
          expect.objectContaining({
            name: 'Files Found',
            value: '2',
            inline: true,
          }),
          expect.objectContaining({
            name: 'Test Writes',
            value: '1',
            inline: true,
          }),
          expect.objectContaining({
            name: 'Debug: Your ID',
            value: 'owner123',
            inline: true,
          }),
        ]),
        timestamp: expect.any(String),
      });
    });

    it('should test volume for Railway environment', async () => {
      const railwayProcess = {
        env: {
          BOT_OWNER_ID: 'owner123',
          NODE_ENV: 'production',
          RAILWAY_ENVIRONMENT: 'production',
        },
      };

      const command = createVolumeTestCommand({
        fs: mockFs,
        path: mockPath,
        process: railwayProcess,
      });

      const context = {
        userId: 'owner123',
        channelId: 'channel123',
        guildId: 'guild123',
        commandPrefix: '!tz',
        isDM: false,
        args: [],
        options: {},
        respond: jest.fn().mockResolvedValue(undefined),
        respondWithEmbed: jest.fn().mockResolvedValue(undefined),
      };

      await command.execute(context);

      // Verify Railway-specific directory
      expect(mockFs.mkdir).toHaveBeenCalledWith('/app/data', { recursive: true });
      expect(mockFs.writeFile).toHaveBeenCalledWith(
        '/app/data/volume_test.txt',
        expect.any(String),
        { flag: 'a' }
      );

      // Verify environment display
      expect(context.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'Environment',
              value: 'Railway (production)',
            }),
          ]),
        })
      );
    });

    it('should handle multiple test writes for persistence check', async () => {
      // Mock multiple lines in test file
      mockFs.readFile.mockResolvedValue(
        'Volume test at 2024-01-01T00:00:00.000Z\nVolume test at 2024-01-01T01:00:00.000Z\nVolume test at 2024-01-01T02:00:00.000Z\n'
      );

      const command = createVolumeTestCommand({
        fs: mockFs,
        path: mockPath,
        process: mockProcess,
      });

      const context = {
        userId: 'owner123',
        channelId: 'channel123',
        guildId: 'guild123',
        commandPrefix: '!tz',
        isDM: false,
        args: [],
        options: {},
        respond: jest.fn().mockResolvedValue(undefined),
        respondWithEmbed: jest.fn().mockResolvedValue(undefined),
      };

      await command.execute(context);

      expect(context.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'Test Writes',
              value: '3',
            }),
            expect.objectContaining({
              name: 'Persistence Check',
              value: '✅ Working! Found 3 entries from previous deployments',
            }),
          ]),
        })
      );
    });

    it('should provide text fallback when embeds not supported', async () => {
      const command = createVolumeTestCommand({
        fs: mockFs,
        path: mockPath,
        process: mockProcess,
      });

      const context = {
        userId: 'owner123',
        channelId: 'channel123',
        guildId: 'guild123',
        commandPrefix: '!tz',
        isDM: false,
        args: [],
        options: {},
        respond: jest.fn().mockResolvedValue(undefined),
        respondWithEmbed: false,
      };

      await command.execute(context);

      expect(context.respond).toHaveBeenCalledWith(
        expect.stringContaining('**📁 Persistent Volume Test**')
      );
      expect(context.respond).toHaveBeenCalledWith(expect.stringContaining('Environment: Local'));
      expect(context.respond).toHaveBeenCalledWith(
        expect.stringContaining('Directory Status: ✅ Exists')
      );
    });

    it('should handle many files gracefully', async () => {
      // Mock many files
      const manyFiles = Array.from({ length: 20 }, (_, i) => `file${i}.json`);
      mockFs.readdir.mockResolvedValue(manyFiles);

      const command = createVolumeTestCommand({
        fs: mockFs,
        path: mockPath,
        process: mockProcess,
      });

      const context = {
        userId: 'owner123',
        channelId: 'channel123',
        guildId: 'guild123',
        commandPrefix: '!tz',
        isDM: false,
        args: [],
        options: {},
        respond: jest.fn().mockResolvedValue(undefined),
        respondWithEmbed: jest.fn().mockResolvedValue(undefined),
      };

      await command.execute(context);

      // Should truncate file list in embed
      expect(context.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'Files in Directory',
              value: expect.stringContaining('...'),
            }),
          ]),
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle file system errors gracefully', async () => {
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      const command = createVolumeTestCommand({
        fs: mockFs,
        path: mockPath,
        process: mockProcess,
      });

      const context = {
        userId: 'owner123',
        channelId: 'channel123',
        guildId: 'guild123',
        commandPrefix: '!tz',
        isDM: false,
        args: [],
        options: {},
        respond: jest.fn().mockResolvedValue(undefined),
      };

      await command.execute(context);

      expect(context.respond).toHaveBeenCalledWith('❌ Volume test failed: Permission denied');
      expect(logger.error).toHaveBeenCalledWith(
        '[VolumeTestCommand] Execution failed:',
        expect.any(Error)
      );
    });

    it('should handle read errors gracefully', async () => {
      mockFs.readFile.mockRejectedValue(new Error('File not found'));

      const command = createVolumeTestCommand({
        fs: mockFs,
        path: mockPath,
        process: mockProcess,
      });

      const context = {
        userId: 'owner123',
        channelId: 'channel123',
        guildId: 'guild123',
        commandPrefix: '!tz',
        isDM: false,
        args: [],
        options: {},
        respond: jest.fn().mockResolvedValue(undefined),
      };

      await command.execute(context);

      expect(context.respond).toHaveBeenCalledWith('❌ Volume test failed: File not found');
    });
  });
});
