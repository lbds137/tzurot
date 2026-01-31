/**
 * Tests for BackupCommand
 */

const {
  createBackupCommand,
  userSessions,
  _formatPersonalityList,
} = require('../../../../../src/application/commands/utility/BackupCommand');
const { BackupJob, BackupStatus } = require('../../../../../src/domain/backup/BackupJob');
const { createMigrationHelper } = require('../../../../utils/testEnhancements');
const logger = require('../../../../../src/logger');

// Mock dependencies
jest.mock('../../../../../src/logger');
jest.mock('../../../../../src/constants', () => ({
  USER_CONFIG: {
    OWNER_PERSONALITIES_LIST: 'Personality1,Personality2,Personality3',
  },
}));

describe('BackupCommand', () => {
  let backupCommand;
  let mockContext;
  let mockBackupService;
  let mockPersonalityDataRepository;
  let mockApiClientService;
  let mockZipArchiveService;
  let migrationHelper;

  beforeEach(() => {
    jest.clearAllMocks();

    // Clear user sessions to avoid test pollution
    userSessions.clear();

    migrationHelper = createMigrationHelper();

    // Mock services
    mockBackupService = {
      executeBackup: jest.fn(),
      delayFn: jest.fn().mockResolvedValue(undefined),
    };

    mockPersonalityDataRepository = {
      load: jest.fn(),
      save: jest.fn(),
    };

    mockApiClientService = {
      fetchPersonalityProfile: jest.fn(),
      fetchCurrentUser: jest.fn(),
    };

    mockZipArchiveService = {
      createPersonalityArchive: jest.fn(),
      createPersonalityArchiveFromMemory: jest.fn(),
      createBulkArchive: jest.fn(),
      createBulkArchiveFromMemory: jest.fn(),
      isWithinDiscordLimits: jest.fn(),
      formatBytes: jest.fn(),
    };

    // Create command with mocked dependencies
    backupCommand = createBackupCommand({
      backupService: mockBackupService,
      personalityDataRepository: mockPersonalityDataRepository,
      apiClientService: mockApiClientService,
      zipArchiveService: mockZipArchiveService,
      delayFn: jest.fn().mockResolvedValue(undefined),
    });

    // Mock context
    mockContext = {
      userId: 'user123',
      channelId: 'channel123',
      guildId: 'guild123',
      commandPrefix: '!tz',
      isDM: jest.fn().mockReturnValue(false),
      args: [],
      options: {},
      respond: jest.fn().mockResolvedValue(undefined),
      respondWithEmbed: jest.fn().mockResolvedValue(undefined),
    };

    // Mock environment
    process.env.SERVICE_WEBSITE = 'https://example.com';
  });

  afterEach(() => {
    delete process.env.SERVICE_WEBSITE;
    delete process.env.BOT_OWNER_ID;
    // Ensure clean state between tests
    userSessions.clear();
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(backupCommand.name).toBe('backup');
      expect(backupCommand.description).toBe(
        'Backup personality data from the AI service'
      );
      expect(backupCommand.category).toBe('Utility');
      expect(backupCommand.aliases).toEqual([]);
      expect(backupCommand.permissions).toEqual(['USER']);
      expect(backupCommand.options).toHaveLength(3);
    });

    it('should have correct command options', () => {
      const options = backupCommand.options;

      expect(options[0].name).toBe('subcommand');
      expect(options[0].required).toBe(false);
      expect(options[0].choices).toHaveLength(5);

      expect(options[1].name).toBe('personality');
      expect(options[1].required).toBe(false);

      expect(options[2].name).toBe('cookie');
      expect(options[2].required).toBe(false);
    });
  });

  describe('execute - configuration checks', () => {
    it('should show error when SERVICE_WEBSITE not configured', async () => {
      delete process.env.SERVICE_WEBSITE;

      await backupCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '❌ Configuration Error',
          description:
            'Backup API URL not configured. Please set SERVICE_WEBSITE in environment.',
          color: 0xf44336,
        })
      );
    });
  });

  describe('execute - help display', () => {
    it('should show help when no subcommand provided', async () => {
      // Set up auth data so we get to the help display
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });

      await backupCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '📦 Backup Command Help',
          description: 'Backup personality data from the AI service',
          color: 0x2196f3,
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'Usage',
              value: expect.stringContaining('backup <personality-name>'),
            }),
            expect.objectContaining({
              name: 'Data Types Backed Up',
              value: expect.stringContaining('Profile configuration'),
            }),
          ]),
        })
      );
    });
  });

  describe('execute - set-cookie subcommand', () => {
    beforeEach(() => {
      mockContext.isDM.mockReturnValue(true); // Required for cookie setting
    });

    it('should set session cookie successfully', async () => {
      mockContext.args = ['set-cookie', 'test-cookie-value'];

      await backupCommand.execute(mockContext);

      expect(userSessions.get('user123')).toEqual({
        cookie: 'appSession=test-cookie-value',
        setAt: expect.any(Number),
      });

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '✅ Cookie Saved',
          description: 'Session cookie saved! You can now use the backup command.',
          color: 0x4caf50,
        })
      );
    });

    it('should use options.cookie if provided', async () => {
      mockContext.options.subcommand = 'set-cookie';
      mockContext.options.cookie = 'option-cookie-value';

      await backupCommand.execute(mockContext);

      expect(userSessions.get('user123').cookie).toBe('appSession=option-cookie-value');
    });

    it('should show error when no cookie provided', async () => {
      mockContext.args = ['set-cookie'];

      await backupCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '❌ Missing Cookie',
          description: 'Please provide your session cookie.',
          color: 0xf44336,
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'How to get your session cookie:',
              value: expect.stringContaining('Open the service website'),
            }),
          ]),
        })
      );
    });

    it('should reject cookie setting in non-DM channels', async () => {
      mockContext.isDM.mockReturnValue(false);
      mockContext.args = ['set-cookie', 'test-cookie'];

      await backupCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '❌ Security Restriction',
          description:
            'For security, please set your session cookie via DM, not in a public channel.',
          color: 0xf44336,
        })
      );

      expect(userSessions.has('user123')).toBe(false);
    });
  });

  describe('execute - authentication checks', () => {
    it('should show error when no session cookie set', async () => {
      mockContext.args = ['TestPersonality'];

      await backupCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '❌ Authentication Required',
          description: 'Session cookie required for backup operations.',
          color: 0xf44336,
          fields: expect.arrayContaining([
            expect.objectContaining({
              name: 'How to set your session cookie:',
              value: expect.stringContaining('backup set-cookie'),
            }),
          ]),
        })
      );
    });
  });

  describe('execute - single personality backup', () => {
    beforeEach(() => {
      // Set up auth data
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });

      // Mock successful backup with proper personalityData setup
      mockBackupService.executeBackup.mockImplementation(async (job, authData, progressCallback) => {
        job.start();
        
        // Simulate the backup service setting personalityData and userDisplayPrefix
        job.personalityData = {
          name: 'testpersonality',
          profile: { id: 'test-id', name: 'TestPersonality' },
          memories: [{ id: 'mem1', content: 'Test memory' }],
          knowledge: [],
          training: [],
          userPersonalization: {},
          chatHistory: [],
          metadata: { lastBackup: new Date().toISOString() }
        };
        
        job.userDisplayPrefix = 'test-user';
        
        const results = {
          profile: { updated: true },
          memories: { newCount: 1, totalCount: 1, updated: true },
          knowledge: { updated: true, entryCount: 0 },
          training: { updated: true, entryCount: 0 },
          userPersonalization: { updated: true },
          chatHistory: { newMessageCount: 1, totalMessages: 1, updated: true }
        };
        
        job.complete(results);
        
        return job;
      });
    });

    it('should execute single personality backup', async () => {
      mockContext.args = ['TestPersonality'];

      await backupCommand.execute(mockContext);

      expect(mockBackupService.executeBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityName: 'testpersonality', // Should be lowercased
          userId: 'user123',
          isBulk: false,
        }),
        { cookie: 'session=test' },
        expect.any(Function) // Progress callback
      );
    });

    it('should handle backup service errors', async () => {
      mockBackupService.executeBackup.mockRejectedValue(new Error('Backup failed'));
      mockContext.args = ['TestPersonality'];

      await backupCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[BackupCommand] Single backup error: Backup failed'
      );
    });

    it('should set persistToFilesystem based on bot owner status for single backup', async () => {
      // Test as bot owner
      process.env.BOT_OWNER_ID = 'user123';
      mockContext.args = ['TestPersonality'];

      await backupCommand.execute(mockContext);

      expect(mockBackupService.executeBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityName: 'testpersonality',
          userId: 'user123',
          isBulk: false,
          persistToFilesystem: true, // Should be true for bot owner
        }),
        { cookie: 'session=test' },
        expect.any(Function)
      );

      // Clear mocks and test as non-owner
      jest.clearAllMocks();
      process.env.BOT_OWNER_ID = 'different-user-id';
      
      await backupCommand.execute(mockContext);

      expect(mockBackupService.executeBackup).toHaveBeenCalledWith(
        expect.objectContaining({
          personalityName: 'testpersonality',
          userId: 'user123',
          isBulk: false,
          persistToFilesystem: false, // Should be false for non-owner
        }),
        { cookie: 'session=test' },
        expect.any(Function)
      );
    });
  });

  describe('execute - bulk backup', () => {
    beforeEach(() => {
      // Set up auth data
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });
      
      // Set user as bot owner for bulk backup tests
      process.env.BOT_OWNER_ID = 'user123';

      // Mock successful bulk backup
      const jobs = [
        new BackupJob({ personalityName: 'Personality1', userId: 'user123', isBulk: true }),
        new BackupJob({ personalityName: 'Personality2', userId: 'user123', isBulk: true }),
        new BackupJob({ personalityName: 'Personality3', userId: 'user123', isBulk: true }),
      ];
      jobs.forEach(job => {
        job.start();
        job.complete({});
      });
      // executeBulkBackup no longer exists - we use executeBackup for each personality
    });

    it('should execute bulk backup', async () => {
      mockContext.args = ['all'];

      await backupCommand.execute(mockContext);

      // Verify executeBackup was called for each personality
      expect(mockBackupService.executeBackup).toHaveBeenCalledTimes(3);
      expect(mockBackupService.executeBackup).toHaveBeenCalledWith(
        expect.objectContaining({ personalityName: 'personality1' }),
        { cookie: 'session=test' },
        expect.any(Function)
      );
      expect(mockBackupService.executeBackup).toHaveBeenCalledWith(
        expect.objectContaining({ personalityName: 'personality2' }),
        { cookie: 'session=test' },
        expect.any(Function)
      );
      expect(mockBackupService.executeBackup).toHaveBeenCalledWith(
        expect.objectContaining({ personalityName: 'personality3' }),
        { cookie: 'session=test' },
        expect.any(Function)
      );
    });

    it('should use options.subcommand for bulk backup', async () => {
      mockContext.options.subcommand = 'all';

      await backupCommand.execute(mockContext);

      // Verify executeBackup was called for individual personalities
      expect(mockBackupService.executeBackup).toHaveBeenCalledTimes(3);
    });

    it('should handle empty owner personalities list', async () => {
      // Temporarily override the mock with empty list
      const { USER_CONFIG } = require('../../../../../src/constants');
      const originalList = USER_CONFIG.OWNER_PERSONALITIES_LIST;
      USER_CONFIG.OWNER_PERSONALITIES_LIST = '';

      mockContext.args = ['all'];
      await backupCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '❌ No Personalities',
          description: 'No owner personalities configured.',
          color: 0xf44336,
        })
      );

      // Restore original value
      USER_CONFIG.OWNER_PERSONALITIES_LIST = originalList;
    });

    it('should handle bulk backup service errors', async () => {
      mockBackupService.executeBackup.mockRejectedValue(new Error('Bulk backup failed'));
      mockContext.args = ['all'];

      await backupCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error backing up Personality1: Bulk backup failed')
      );
    });

    it('should deny bulk backup for non-owner users', async () => {
      // Override to make user not the bot owner
      process.env.BOT_OWNER_ID = 'different-user-id';
      
      // Set up auth data for non-owner user
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });
      
      mockContext.args = ['all'];
      await backupCommand.execute(mockContext);

      expect(mockContext.respondWithEmbed).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '❌ Access Denied',
          description: 'Bulk backup is only available to the bot owner. Use single personality backup instead.',
          color: 0xf44336,
        })
      );

      // Should not call backup service
      expect(mockBackupService.executeBackup).not.toHaveBeenCalled();
    });
  });

  describe('execute - error handling', () => {
    beforeEach(() => {
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });
    });

    it('should handle unexpected errors gracefully', async () => {
      // Mock backup service to throw an error
      mockBackupService.executeBackup.mockRejectedValue(new Error('Unexpected error'));

      mockContext.args = ['TestPersonality'];
      await backupCommand.execute(mockContext);

      // The error should be caught and logged by the single backup handler
      expect(logger.error).toHaveBeenCalledWith(
        '[BackupCommand] Single backup error: Unexpected error'
      );

      // No user response is sent for single backup errors - they are logged only
      // This is the current behavior of the implementation
    });
  });

  describe('progress callback functionality', () => {
    beforeEach(() => {
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });
    });

    it('should pass progress messages to context.respond', async () => {
      let progressCallback;
      mockBackupService.executeBackup.mockImplementation((job, authData, callback) => {
        progressCallback = callback;
        return Promise.resolve(job);
      });

      mockContext.args = ['TestPersonality'];
      await backupCommand.execute(mockContext);

      // Simulate progress callback
      await progressCallback('Test progress message');

      expect(mockContext.respond).toHaveBeenCalledWith('Test progress message');
    });

    it('should pass progress messages for bulk backup', async () => {
      // Set user as bot owner for bulk backup
      process.env.BOT_OWNER_ID = 'user123';
      
      mockBackupService.executeBackup.mockImplementation(async (job, authData, callback) => {
        job.start();
        // Call the progress callback with test message
        if (callback) {
          await callback('Bulk progress message');
        }
        job.complete({});
        return job;
      });

      mockContext.args = ['all'];
      await backupCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith('Bulk progress message');
    });
  });

  describe('factory function', () => {
    it('should create command with default dependencies', () => {
      const command = createBackupCommand();

      expect(command).toBeDefined();
      expect(command.name).toBe('backup');
      expect(command.permissions).toEqual(['USER']);
    });

    it('should create command with custom dependencies', () => {
      const customBackupService = { executeBackup: jest.fn() };
      const command = createBackupCommand({
        backupService: customBackupService,
      });

      expect(command).toBeDefined();
      expect(command.name).toBe('backup');
    });
  });

  describe('userSessions management', () => {
    it('should store session data correctly', () => {
      const sessionData = {
        cookie: 'appSession=test123',
        setAt: Date.now(),
      };

      userSessions.set('user456', sessionData);

      expect(userSessions.get('user456')).toEqual(sessionData);
    });

    it('should clear sessions', () => {
      userSessions.set('user1', { cookie: 'test1', setAt: Date.now() });
      userSessions.set('user2', { cookie: 'test2', setAt: Date.now() });

      expect(userSessions.size).toBe(2);

      userSessions.clear();

      expect(userSessions.size).toBe(0);
    });
  });

  describe('personality list formatting', () => {
    describe('_formatPersonalityList', () => {
      it('should format short lists normally', () => {
        const personalities = ['Alpha', 'Beta', 'Gamma'];
        const result = _formatPersonalityList(personalities);
        
        expect(result).toBe('• Alpha\n• Beta\n• Gamma');
      });
      
      it('should truncate long lists with many items', () => {
        const personalities = Array.from({ length: 100 }, (_, i) => `VeryLongPersonalityNameNumber${i}`);
        const result = _formatPersonalityList(personalities);
        
        expect(result.length).toBeLessThanOrEqual(1024);
        expect(result).toContain('...and');
        expect(result).toContain('more');
      });
      
      it('should handle empty list', () => {
        const result = _formatPersonalityList([]);
        expect(result).toBe('None');
      });
      
      it('should handle single item', () => {
        const result = _formatPersonalityList(['OnlyOne']);
        expect(result).toBe('• OnlyOne');
      });
    });
    it('should handle bulk backup with many personalities without exceeding embed limits', async () => {
      // Set up auth data
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });
      process.env.BOT_OWNER_ID = 'user123';
      
      // Create a large list of personalities
      const manyPersonalities = Array.from({ length: 100 }, (_, i) => `VeryLongPersonalityName${i}`);
      jest.resetModules();
      jest.doMock('../../../../../src/constants', () => ({
        USER_CONFIG: {
          OWNER_PERSONALITIES_LIST: manyPersonalities.join(','),
        },
      }));
      
      // Re-import after mocking
      const { createBackupCommand: createBackupCommandLarge, userSessions: largeUserSessions } = require('../../../../../src/application/commands/utility/BackupCommand');
      const largeCommand = createBackupCommandLarge({
        backupService: mockBackupService,
        personalityDataRepository: mockPersonalityDataRepository,
        apiClientService: mockApiClientService,
        zipArchiveService: mockZipArchiveService,
        delayFn: jest.fn().mockResolvedValue(undefined),
      });
      
      // Set up user session for the new command instance
      largeUserSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });
      
      // Mock successful backups
      mockBackupService.executeBackup.mockImplementation(async (job) => {
        job.start();
        job.personalityData = {
          name: job.personalityName,
          profile: { id: 'test-id', name: job.personalityName },
          memories: [],
          knowledge: [],
          training: [],
          userPersonalization: {},
          chatHistory: [],
          metadata: { lastBackup: new Date().toISOString() }
        };
        job.userDisplayPrefix = 'test-user';
        job.complete({});
        return job;
      });
      
      // Mock ZIP creation
      mockZipArchiveService.createPersonalityArchiveFromMemory.mockResolvedValue(Buffer.from('zip'));
      mockZipArchiveService.isWithinDiscordLimits.mockReturnValue(true);
      mockZipArchiveService.formatBytes.mockReturnValue('1 KB');
      
      mockContext.args = ['all'];
      await largeCommand.execute(mockContext);
      
      // Find the summary embed
      const summaryCall = mockContext.respondWithEmbed.mock.calls.find(
        call => call[0].title === '📦 Bulk Backup Complete'
      );
      
      expect(summaryCall).toBeDefined();
      
      // Check that the successful backups field exists and is under the limit
      const successField = summaryCall[0].fields.find(f => f.name === '✅ Successful Backups');
      expect(successField).toBeDefined();
      expect(successField.value.length).toBeLessThanOrEqual(1024);
      expect(successField.value).toContain('...and');
      expect(successField.value).toContain('more');
    });
  });

  describe('integration with BackupService', () => {
    beforeEach(() => {
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });
    });

    it('should create BackupService when not provided', async () => {
      // Create command without backup service
      const commandWithoutService = createBackupCommand({
        personalityDataRepository: mockPersonalityDataRepository,
        apiClientService: mockApiClientService,
      });

      // Mock the actual backup execution to avoid real API calls
      jest
        .spyOn(require('../../../../../src/domain/backup/BackupService'), 'BackupService')
        .mockImplementation(() => ({
          executeBackup: jest.fn().mockResolvedValue(
            new BackupJob({
              personalityName: 'Test',
              userId: 'user123',
            })
          ),
        }));

      mockContext.args = ['TestPersonality'];
      await commandWithoutService.execute(mockContext);

      // Should not throw error - service should be created internally
      expect(mockContext.respond).toHaveBeenCalled();
    });

    it('should pass correct auth data to backup service', async () => {
      const authData = { cookie: 'session=test' };
      mockContext.args = ['TestPersonality'];

      await backupCommand.execute(mockContext);

      expect(mockBackupService.executeBackup).toHaveBeenCalledWith(
        expect.any(Object), // job
        authData,
        expect.any(Function) // progress callback
      );
    });
  });

  describe('ZIP file creation and attachment', () => {
    beforeEach(() => {
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });
      
      // Mock successful backup with proper personalityData setup
      mockBackupService.executeBackup.mockImplementation(async (job, authData, progressCallback) => {
        job.start();
        
        // Simulate the backup service setting personalityData and userDisplayPrefix
        job.personalityData = {
          name: 'testpersonality',
          profile: { id: 'test-id', name: 'TestPersonality' },
          memories: [{ id: 'mem1', content: 'Test memory' }],
          knowledge: [],
          training: [],
          userPersonalization: {},
          chatHistory: [],
          metadata: { lastBackup: new Date().toISOString() }
        };
        
        job.userDisplayPrefix = 'test-user';
        
        const results = {
          profile: { updated: true },
          memories: { newCount: 5, totalCount: 10, updated: true },
          knowledge: { updated: false, entryCount: 3 },
          training: { updated: true, entryCount: 7 },
          userPersonalization: { updated: false },
          chatHistory: { newMessageCount: 15, totalMessages: 100, updated: true }
        };
        
        job.complete(results);
        
        return job;
      });
    });

    describe('single personality backup', () => {
      const mockZipBuffer = Buffer.from('mock-zip-content');

      beforeEach(() => {
        mockZipArchiveService.createPersonalityArchiveFromMemory.mockResolvedValue(mockZipBuffer);
        mockZipArchiveService.isWithinDiscordLimits.mockReturnValue(true);
        mockZipArchiveService.formatBytes.mockReturnValue('1.5 MB');
      });

      it('should create and send ZIP file after successful backup', async () => {
        mockContext.args = ['TestPersonality'];
        await backupCommand.execute(mockContext);

        // Verify ZIP creation
        expect(mockZipArchiveService.createPersonalityArchiveFromMemory).toHaveBeenCalledWith(
          'testpersonality',
          expect.objectContaining({
            name: 'testpersonality',
            profile: expect.any(Object),
            memories: expect.any(Array),
            knowledge: expect.any(Array),
            training: expect.any(Array),
            userPersonalization: expect.any(Object),
            chatHistory: expect.any(Array),
            metadata: expect.any(Object)
          }),
          expect.objectContaining({
            profile: expect.any(Object),
            memories: expect.any(Object),
            knowledge: expect.any(Object),
            training: expect.any(Object),
            userPersonalization: expect.any(Object),
            chatHistory: expect.any(Object)
          })
        );

        // Verify Discord limit check
        expect(mockZipArchiveService.isWithinDiscordLimits).toHaveBeenCalledWith(mockZipBuffer.length);

        // Verify response includes ZIP attachment
        const embedCall = mockContext.respond.mock.calls.find(
          call => call[0].files && call[0].files.length > 0
        );
        expect(embedCall).toBeDefined();
        expect(embedCall[0].files[0]).toEqual({
          attachment: mockZipBuffer,
          name: expect.stringMatching(/^test-user_testpersonality_backup_\d{4}-\d{2}-\d{2}\.zip$/),
        });
        expect(embedCall[0].embeds[0].title).toBe('✅ Backup Complete');
        expect(embedCall[0].embeds[0].fields).toContainEqual({
          name: '💾 Archive Size',
          value: '1.5 MB',
          inline: true,
        });
      });

      it('should handle ZIP files that exceed Discord limits', async () => {
        const largeBuffer = Buffer.alloc(10 * 1024 * 1024); // 10MB
        mockZipArchiveService.createPersonalityArchiveFromMemory.mockResolvedValue(largeBuffer);
        mockZipArchiveService.isWithinDiscordLimits.mockReturnValue(false);
        mockZipArchiveService.formatBytes.mockReturnValue('10 MB');

        mockContext.args = ['TestPersonality'];
        await backupCommand.execute(mockContext);

        // Should not send file attachment
        const attachmentCall = mockContext.respond.mock.calls.find(
          call => call[0].files && call[0].files.length > 0
        );
        expect(attachmentCall).toBeUndefined();

        // Should send warning embed
        const warningCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '⚠️ File Too Large'
        );
        expect(warningCall).toBeDefined();
        expect(warningCall[0].description).toContain('10 MB');
        expect(warningCall[0].description).toContain('Maximum file size is 8MB');
      });

      it('should handle ZIP creation errors gracefully', async () => {
        mockZipArchiveService.createPersonalityArchiveFromMemory.mockRejectedValue(
          new Error('ZIP creation failed')
        );

        mockContext.args = ['TestPersonality'];
        await backupCommand.execute(mockContext);

        // Should log error
        expect(logger.error).toHaveBeenCalledWith(
          '[BackupCommand] ZIP creation error: ZIP creation failed'
        );

        // Should send warning embed
        const warningCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '⚠️ Archive Creation Failed'
        );
        expect(warningCall).toBeDefined();
        expect(warningCall[0].description).toContain(
          'The backup was successful but failed to create ZIP archive'
        );
      });
    });

    describe('bulk backup', () => {
      const mockZipBuffer = Buffer.from('mock-zip-content');
      const mockBulkZipBuffer = Buffer.from('mock-bulk-zip-content');
      const personalities = ['Personality1', 'Personality2', 'Personality3'];

      beforeEach(() => {
        // Set user as bot owner for bulk backup tests
        process.env.BOT_OWNER_ID = 'user123';
        
        // Mock the individual archive creation (not bulk anymore)
        mockZipArchiveService.createPersonalityArchiveFromMemory.mockResolvedValue(mockZipBuffer);
        mockZipArchiveService.createBulkArchiveFromMemory.mockResolvedValue(mockBulkZipBuffer);
        mockZipArchiveService.isWithinDiscordLimits.mockReturnValue(true);
        mockZipArchiveService.formatBytes.mockReturnValue('1.2 MB');
        
        // Mock successful bulk backup
        const bulkJobs = personalities.map(name => {
          const job = new BackupJob({
            personalityName: name.toLowerCase(),
            userId: 'user123',
            isBulk: true,
          });
          job.start();
          job.complete({});
          
          // Add mock personality data for ZIP creation
          job.personalityData = {
            name: name.toLowerCase(),
            profile: { id: 'test-id', name: name },
            memories: [{ id: 'mem1', content: 'Test memory' }],
            knowledge: [],
            training: [],
            userPersonalization: {},
            chatHistory: [],
            metadata: { lastBackup: new Date().toISOString() }
          };
          
          // Add user display prefix for bulk ZIP naming
          job.userDisplayPrefix = 'test-user';
          
          return job;
        });
        
        // Mock individual executeBackup calls for bulk operation
        mockBackupService.executeBackup.mockImplementation(async (job) => {
          // Find the matching job from our test data
          const matchingJob = bulkJobs.find(j => j.personalityName === job.personalityName);
          if (matchingJob) {
            // Copy the test data to the actual job
            job.personalityData = matchingJob.personalityData;
            job.userDisplayPrefix = matchingJob.userDisplayPrefix;
            job.start();
            // Make sure results are properly set
            job.results = {
              profile: { updated: true },
              memories: { newCount: 1, totalCount: 1, updated: true },
              knowledge: { updated: false, skipped: true, reason: 'Non-owner access', entryCount: 0 },
              training: { updated: false, skipped: true, reason: 'Non-owner access', entryCount: 0 },
              userPersonalization: { updated: false },
              chatHistory: { newMessageCount: 0, totalMessages: 0, updated: false }
            };
            job.complete(job.results);
          }
          return job;
        });
      });

      it('should create and send individual ZIP files after successful backups', async () => {
        mockContext.args = ['all'];
        await backupCommand.execute(mockContext);

        // Verify individual ZIP creation for each personality
        expect(mockZipArchiveService.createPersonalityArchiveFromMemory).toHaveBeenCalledTimes(3);
        expect(mockZipArchiveService.createPersonalityArchiveFromMemory).toHaveBeenCalledWith(
          'personality1',
          expect.any(Object),
          expect.any(Object)
        );
        expect(mockZipArchiveService.createPersonalityArchiveFromMemory).toHaveBeenCalledWith(
          'personality2',
          expect.any(Object),
          expect.any(Object)
        );
        expect(mockZipArchiveService.createPersonalityArchiveFromMemory).toHaveBeenCalledWith(
          'personality3',
          expect.any(Object),
          expect.any(Object)
        );

        // Verify bulk ZIP creation is NOT called (we now send individual files)
        expect(mockZipArchiveService.createBulkArchiveFromMemory).not.toHaveBeenCalled();

        // Verify starting message was sent first
        const startingCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '📦 Starting Bulk Backup'
        );
        expect(startingCall).toBeDefined();
        expect(startingCall[0].description).toContain('Beginning backup of 3 personalities');

        // Verify summary embed was sent
        const summaryCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '📦 Bulk Backup Complete'
        );
        expect(summaryCall).toBeDefined();
        // Check that some personalities were backed up successfully
        expect(summaryCall[0].description).toContain('Successfully backed up');

        // Verify individual ZIP files were sent
        const fileResponses = mockContext.respond.mock.calls.filter(
          call => call[0] && call[0].files && call[0].files.length > 0
        );
        
        // If no files found, it means there's an issue with the test setup
        
        expect(fileResponses).toHaveLength(3);
        
        // Check each file has correct structure
        fileResponses.forEach((response, index) => {
          expect(response[0].files[0]).toEqual({
            attachment: mockZipBuffer,
            name: expect.stringMatching(/^test-user_personality\d+_backup_\d{4}-\d{2}-\d{2}\.zip$/),
          });
          expect(response[0].embeds[0].title).toBe('✅ Backup Complete');
        });
      });

      it('should handle individual ZIP files that exceed Discord limits', async () => {
        const largeBuffer = Buffer.alloc(20 * 1024 * 1024); // 20MB
        mockZipArchiveService.createPersonalityArchiveFromMemory.mockResolvedValue(largeBuffer);
        mockZipArchiveService.isWithinDiscordLimits.mockReturnValue(false);
        mockZipArchiveService.formatBytes.mockReturnValue('20 MB');

        mockContext.args = ['all'];
        await backupCommand.execute(mockContext);

        // Should send warning embeds for each large file
        const warningCalls = mockContext.respondWithEmbed.mock.calls.filter(
          call => call[0].title === '⚠️ File Too Large'
        );
        expect(warningCalls).toHaveLength(3); // One for each personality
        
        warningCalls.forEach(call => {
          expect(call[0].description).toContain('20 MB');
          expect(call[0].description).toContain('too large to send via Discord');
        });

        // Should not send file attachments
        const attachmentCalls = mockContext.respond.mock.calls.filter(
          call => call[0].files && call[0].files.length > 0
        );
        expect(attachmentCalls).toHaveLength(0);
      });

      it('should handle individual ZIP creation errors gracefully', async () => {
        mockZipArchiveService.createPersonalityArchiveFromMemory.mockRejectedValue(
          new Error('Individual ZIP creation failed')
        );

        mockContext.args = ['all'];
        await backupCommand.execute(mockContext);

        // Should send error embeds for each failed ZIP creation
        const errorCalls = mockContext.respondWithEmbed.mock.calls.filter(
          call => call[0].title === '⚠️ ZIP Creation Failed'
        );
        expect(errorCalls).toHaveLength(3); // One for each personality
        
        errorCalls.forEach(call => {
          expect(call[0].description).toContain('Data was backed up successfully but ZIP delivery failed');
        });

        // Should still send summary at the end
        const summaryCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '📦 Bulk Backup Complete'
        );
        expect(summaryCall).toBeDefined();

      });
    });

    describe('path construction', () => {
      it('should use correct in-memory data for ZIP creation', async () => {
        mockContext.args = ['TestPersonality'];
        await backupCommand.execute(mockContext);

        expect(mockZipArchiveService.createPersonalityArchiveFromMemory).toHaveBeenCalledWith(
          'testpersonality',
          expect.objectContaining({
            name: 'testpersonality',
            profile: expect.any(Object),
            memories: expect.any(Array)
          }),
          expect.any(Object) // job.results
        );
      });

      it('should handle empty owner personality list', async () => {
        // Set user as bot owner for bulk backup access
        process.env.BOT_OWNER_ID = 'user123';
        
        // Mock empty personality list
        jest.resetModules();
        jest.doMock('../../../../../src/constants', () => ({
          USER_CONFIG: {
            OWNER_PERSONALITIES_LIST: '',
          },
        }));

        const { createBackupCommand: createBackupCommandEmpty } = require('../../../../../src/application/commands/utility/BackupCommand');
        const emptyCommand = createBackupCommandEmpty({
          backupService: mockBackupService,
          personalityDataRepository: mockPersonalityDataRepository,
          apiClientService: mockApiClientService,
          zipArchiveService: mockZipArchiveService,
          delayFn: jest.fn().mockResolvedValue(undefined),
        });

        // Need to set up user session for the empty command instance
        const { userSessions: emptyUserSessions } = require('../../../../../src/application/commands/utility/BackupCommand');
        emptyUserSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });

        mockContext.args = ['all'];
        await emptyCommand.execute(mockContext);

        const errorCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '❌ No Personalities'
        );
        expect(errorCall).toBeDefined();
        expect(mockZipArchiveService.createBulkArchiveFromMemory).not.toHaveBeenCalled();
      });
    });
    
    describe('category backup (self/recent)', () => {
      beforeEach(() => {
        // Set up auth data
        userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });
        
        // Mock successful fetchPersonalitiesByCategory
        mockApiClientService.fetchPersonalitiesByCategory = jest.fn();
        
        // Mock successful backup execution
        mockBackupService.executeBackup.mockImplementation(async (job) => {
          job.start();
          job.personalityData = {
            name: job.personalityName,
            profile: { id: 'test-id', name: job.personalityName },
            memories: [],
            knowledge: [],
            training: [],
            userPersonalization: {},
            chatHistory: [],
            metadata: { lastBackup: new Date().toISOString() }
          };
          job.userDisplayPrefix = 'test-user';
          job.complete({});
          return job;
        });
        
        // Mock ZIP creation
        mockZipArchiveService.createPersonalityArchiveFromMemory.mockResolvedValue(Buffer.from('zip'));
        mockZipArchiveService.isWithinDiscordLimits.mockReturnValue(true);
        mockZipArchiveService.formatBytes.mockReturnValue('1 KB');
      });
      
      it('should backup self personalities', async () => {
        const selfPersonalities = [
          { id: '123456789012345678', username: 'MyPersonality1' },
          { id: '223456789012345678', username: 'MyPersonality2' }
        ];
        mockApiClientService.fetchPersonalitiesByCategory.mockResolvedValue(selfPersonalities);
        
        mockContext.args = ['self'];
        await backupCommand.execute(mockContext);
        
        // Verify API was called correctly
        expect(mockApiClientService.fetchPersonalitiesByCategory).toHaveBeenCalledWith('self', { cookie: 'session=test' });
        
        // Verify starting embed
        const startingCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '📦 Starting Self-Owned Backup'
        );
        expect(startingCall).toBeDefined();
        expect(startingCall[0].description).toContain('Beginning backup of 2 self personalities');
        
        // Verify individual backups were executed
        expect(mockBackupService.executeBackup).toHaveBeenCalledTimes(2);
        
        // Verify jobs have persistToFilesystem: false
        const firstCall = mockBackupService.executeBackup.mock.calls[0];
        expect(firstCall[0].persistToFilesystem).toBe(false);
        
        // Verify ZIP files were created and sent
        expect(mockZipArchiveService.createPersonalityArchiveFromMemory).toHaveBeenCalledTimes(2);
        
        // Verify summary embed
        const summaryCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '📦 Self-Owned Backup Complete'
        );
        expect(summaryCall).toBeDefined();
      });
      
      it('should backup recent personalities', async () => {
        const recentPersonalities = [
          { id: '323456789012345678', username: 'RecentPersonality1' },
          { id: '423456789012345678', username: 'RecentPersonality2' },
          { id: '523456789012345678', username: 'RecentPersonality3' }
        ];
        mockApiClientService.fetchPersonalitiesByCategory.mockResolvedValue(recentPersonalities);
        
        mockContext.args = ['recent'];
        await backupCommand.execute(mockContext);
        
        // Verify API was called correctly
        expect(mockApiClientService.fetchPersonalitiesByCategory).toHaveBeenCalledWith('recent', { cookie: 'session=test' });
        
        // Verify starting embed
        const startingCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '📦 Starting Recent Backup'
        );
        expect(startingCall).toBeDefined();
        expect(startingCall[0].description).toContain('Beginning backup of 3 recent personalities');
        
        // Verify summary embed
        const summaryCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '📦 Recent Backup Complete'
        );
        expect(summaryCall).toBeDefined();
      });
      
      it('should handle empty category results', async () => {
        mockApiClientService.fetchPersonalitiesByCategory.mockResolvedValue([]);
        
        mockContext.args = ['self'];
        await backupCommand.execute(mockContext);
        
        const errorCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '❌ No Personalities Found'
        );
        expect(errorCall).toBeDefined();
        expect(errorCall[0].description).toContain('No self personalities found');
        
        // Should not attempt any backups
        expect(mockBackupService.executeBackup).not.toHaveBeenCalled();
      });
      
      it('should handle API fetch errors', async () => {
        mockApiClientService.fetchPersonalitiesByCategory.mockRejectedValue(new Error('API Error'));
        
        mockContext.args = ['recent'];
        await backupCommand.execute(mockContext);
        
        const errorCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '❌ Backup Failed'
        );
        expect(errorCall).toBeDefined();
        expect(errorCall[0].description).toContain('Failed to fetch recent personalities');
      });
      
      it('should handle many personalities with Discord embed limits', async () => {
        // Create 100 personalities to test truncation
        const manyPersonalities = Array.from({ length: 100 }, (_, i) => ({
          id: `id${i}`,
          username: `VeryLongPersonalityNameForTesting${i}`
        }));
        mockApiClientService.fetchPersonalitiesByCategory.mockResolvedValue(manyPersonalities);
        
        mockContext.args = ['self'];
        await backupCommand.execute(mockContext);
        
        // Verify summary embed handles long lists
        const summaryCall = mockContext.respondWithEmbed.mock.calls.find(
          call => call[0].title === '📦 Self-Owned Backup Complete'
        );
        expect(summaryCall).toBeDefined();
        
        const successField = summaryCall[0].fields.find(f => f.name === '✅ Successful Backups');
        expect(successField).toBeDefined();
        expect(successField.value.length).toBeLessThanOrEqual(1024);
        expect(successField.value).toContain('...and');
        expect(successField.value).toContain('more');
      });
    });
  });
});
