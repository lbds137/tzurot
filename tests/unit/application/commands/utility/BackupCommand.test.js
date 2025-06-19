/**
 * Tests for BackupCommand
 */

const {
  createBackupCommand,
  userSessions,
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
      executeBulkBackup: jest.fn(),
    };

    mockPersonalityDataRepository = {
      load: jest.fn(),
      save: jest.fn(),
    };

    mockApiClientService = {
      fetchPersonalityProfile: jest.fn(),
    };

    mockZipArchiveService = {
      createPersonalityArchive: jest.fn(),
      createBulkArchive: jest.fn(),
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
      commandPrefix: '!tz ',
      isDM: false,
      args: [],
      options: {},
      respond: jest.fn().mockResolvedValue(undefined),
    };

    // Mock environment
    process.env.SERVICE_WEBSITE = 'https://example.com';
  });

  afterEach(() => {
    delete process.env.SERVICE_WEBSITE;
    // Ensure clean state between tests
    userSessions.clear();
  });

  describe('metadata', () => {
    it('should have correct command metadata', () => {
      expect(backupCommand.name).toBe('backup');
      expect(backupCommand.description).toBe(
        'Backup personality data from the AI service (Requires Administrator permission)'
      );
      expect(backupCommand.category).toBe('Utility');
      expect(backupCommand.aliases).toEqual([]);
      expect(backupCommand.adminOnly).toBe(true);
      expect(backupCommand.options).toHaveLength(3);
    });

    it('should have correct command options', () => {
      const options = backupCommand.options;

      expect(options[0].name).toBe('subcommand');
      expect(options[0].required).toBe(false);
      expect(options[0].choices).toHaveLength(3);

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

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Configuration Error',
            description:
              'Backup API URL not configured. Please set SERVICE_WEBSITE in environment.',
            color: 0xf44336,
          }),
        ],
      });
    });
  });

  describe('execute - help display', () => {
    it('should show help when no subcommand provided', async () => {
      // Set up auth data so we get to the help display
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });

      await backupCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
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
          }),
        ],
      });
    });
  });

  describe('execute - set-cookie subcommand', () => {
    beforeEach(() => {
      mockContext.isDM = true; // Required for cookie setting
    });

    it('should set session cookie successfully', async () => {
      mockContext.args = ['set-cookie', 'test-cookie-value'];

      await backupCommand.execute(mockContext);

      expect(userSessions.get('user123')).toEqual({
        cookie: 'appSession=test-cookie-value',
        setAt: expect.any(Number),
      });

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '✅ Cookie Saved',
            description: 'Session cookie saved! You can now use the backup command.',
            color: 0x4caf50,
          }),
        ],
      });
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

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
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
          }),
        ],
      });
    });

    it('should reject cookie setting in non-DM channels', async () => {
      mockContext.isDM = false;
      mockContext.args = ['set-cookie', 'test-cookie'];

      await backupCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ Security Restriction',
            description:
              'For security, please set your session cookie via DM, not in a public channel.',
            color: 0xf44336,
          }),
        ],
      });

      expect(userSessions.has('user123')).toBe(false);
    });
  });

  describe('execute - authentication checks', () => {
    it('should show error when no session cookie set', async () => {
      mockContext.args = ['TestPersonality'];

      await backupCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
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
          }),
        ],
      });
    });
  });

  describe('execute - single personality backup', () => {
    beforeEach(() => {
      // Set up auth data
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });

      // Mock successful backup
      const completedJob = new BackupJob({
        personalityName: 'TestPersonality',
        userId: 'user123',
      });
      completedJob.start();
      completedJob.complete({});
      mockBackupService.executeBackup.mockResolvedValue(completedJob);
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
  });

  describe('execute - bulk backup', () => {
    beforeEach(() => {
      // Set up auth data
      userSessions.set('user123', { cookie: 'session=test', setAt: Date.now() });

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
      mockBackupService.executeBulkBackup.mockResolvedValue(jobs);
    });

    it('should execute bulk backup', async () => {
      mockContext.args = ['all'];

      await backupCommand.execute(mockContext);

      expect(mockBackupService.executeBulkBackup).toHaveBeenCalledWith(
        ['Personality1', 'Personality2', 'Personality3'],
        'user123',
        { cookie: 'session=test' },
        expect.any(Function) // Progress callback
      );
    });

    it('should use options.subcommand for bulk backup', async () => {
      mockContext.options.subcommand = 'all';

      await backupCommand.execute(mockContext);

      expect(mockBackupService.executeBulkBackup).toHaveBeenCalled();
    });

    it('should handle empty owner personalities list', async () => {
      // Temporarily override the mock with empty list
      const { USER_CONFIG } = require('../../../../../src/constants');
      const originalList = USER_CONFIG.OWNER_PERSONALITIES_LIST;
      USER_CONFIG.OWNER_PERSONALITIES_LIST = '';

      mockContext.args = ['all'];
      await backupCommand.execute(mockContext);

      expect(mockContext.respond).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: '❌ No Personalities',
            description: 'No owner personalities configured.',
            color: 0xf44336,
          }),
        ],
      });

      // Restore original value
      USER_CONFIG.OWNER_PERSONALITIES_LIST = originalList;
    });

    it('should handle bulk backup service errors', async () => {
      mockBackupService.executeBulkBackup.mockRejectedValue(new Error('Bulk backup failed'));
      mockContext.args = ['all'];

      await backupCommand.execute(mockContext);

      expect(logger.error).toHaveBeenCalledWith(
        '[BackupCommand] Bulk backup error: Bulk backup failed'
      );
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
      let progressCallback;
      mockBackupService.executeBulkBackup.mockImplementation(
        (personalities, userId, authData, callback) => {
          progressCallback = callback;
          return Promise.resolve([]);
        }
      );

      mockContext.args = ['all'];
      await backupCommand.execute(mockContext);

      // Simulate progress callback
      await progressCallback('Bulk progress message');

      expect(mockContext.respond).toHaveBeenCalledWith('Bulk progress message');
    });
  });

  describe('factory function', () => {
    it('should create command with default dependencies', () => {
      const command = createBackupCommand();

      expect(command).toBeDefined();
      expect(command.name).toBe('backup');
      expect(command.adminOnly).toBe(true);
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
      
      // Mock successful backup job
      const successfulJob = new BackupJob({
        personalityName: 'testpersonality',
        userId: 'user123',
        isBulk: false,
      });
      successfulJob.start();
      successfulJob.complete({
        profile: { updated: true },
        memories: { newCount: 5, totalCount: 10, updated: true },
        knowledge: { updated: false, entryCount: 3 },
        training: { updated: true, entryCount: 7 },
        userPersonalization: { updated: false },
        chatHistory: { newMessageCount: 15, totalMessages: 100, updated: true },
      });
      
      mockBackupService.executeBackup.mockResolvedValue(successfulJob);
    });

    describe('single personality backup', () => {
      const mockZipBuffer = Buffer.from('mock-zip-content');

      beforeEach(() => {
        mockZipArchiveService.createPersonalityArchive.mockResolvedValue(mockZipBuffer);
        mockZipArchiveService.isWithinDiscordLimits.mockReturnValue(true);
        mockZipArchiveService.formatBytes.mockReturnValue('1.5 MB');
      });

      it('should create and send ZIP file after successful backup', async () => {
        mockContext.args = ['TestPersonality'];
        await backupCommand.execute(mockContext);

        // Verify ZIP creation
        expect(mockZipArchiveService.createPersonalityArchive).toHaveBeenCalledWith(
          'testpersonality',
          expect.stringContaining('testpersonality')
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
          name: expect.stringMatching(/^testpersonality_backup_\d{4}-\d{2}-\d{2}\.zip$/),
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
        mockZipArchiveService.createPersonalityArchive.mockResolvedValue(largeBuffer);
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
        const warningCall = mockContext.respond.mock.calls.find(
          call => call[0].embeds && call[0].embeds[0].title === '⚠️ File Too Large'
        );
        expect(warningCall).toBeDefined();
        expect(warningCall[0].embeds[0].description).toContain('10 MB');
        expect(warningCall[0].embeds[0].description).toContain('Maximum file size is 8MB');
      });

      it('should handle ZIP creation errors gracefully', async () => {
        mockZipArchiveService.createPersonalityArchive.mockRejectedValue(
          new Error('ZIP creation failed')
        );

        mockContext.args = ['TestPersonality'];
        await backupCommand.execute(mockContext);

        // Should log error
        expect(logger.error).toHaveBeenCalledWith(
          '[BackupCommand] ZIP creation error: ZIP creation failed'
        );

        // Should send warning embed
        const warningCall = mockContext.respond.mock.calls.find(
          call => call[0].embeds && call[0].embeds[0].title === '⚠️ Archive Creation Failed'
        );
        expect(warningCall).toBeDefined();
        expect(warningCall[0].embeds[0].description).toContain(
          'The backup was successful but failed to create ZIP archive'
        );
      });
    });

    describe('bulk backup', () => {
      const mockBulkZipBuffer = Buffer.from('mock-bulk-zip-content');
      const personalities = ['Personality1', 'Personality2', 'Personality3'];

      beforeEach(() => {
        mockZipArchiveService.createBulkArchive.mockResolvedValue(mockBulkZipBuffer);
        mockZipArchiveService.isWithinDiscordLimits.mockReturnValue(true);
        mockZipArchiveService.formatBytes.mockReturnValue('3.2 MB');
        
        // Mock successful bulk backup
        const bulkJobs = personalities.map(name => {
          const job = new BackupJob({
            personalityName: name.toLowerCase(),
            userId: 'user123',
            isBulk: true,
          });
          job.start();
          job.complete({});
          return job;
        });
        
        mockBackupService.executeBulkBackup.mockResolvedValue(bulkJobs);
      });

      it('should create and send bulk ZIP file after successful backups', async () => {
        mockContext.args = ['all'];
        await backupCommand.execute(mockContext);

        // Verify bulk ZIP creation
        expect(mockZipArchiveService.createBulkArchive).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({ name: 'personality1' }),
            expect.objectContaining({ name: 'personality2' }),
            expect.objectContaining({ name: 'personality3' }),
          ])
        );

        // Verify response includes ZIP attachment
        const embedCall = mockContext.respond.mock.calls.find(
          call => call[0].files && call[0].files.length > 0
        );
        expect(embedCall).toBeDefined();
        expect(embedCall[0].files[0]).toEqual({
          attachment: mockBulkZipBuffer,
          name: expect.stringMatching(/^tzurot_bulk_backup_\d{4}-\d{2}-\d{2}\.zip$/),
        });
        expect(embedCall[0].embeds[0].title).toBe('✅ Bulk Backup Complete');
        expect(embedCall[0].embeds[0].fields).toContainEqual({
          name: '💾 Archive Size',
          value: '3.2 MB',
          inline: true,
        });
      });

      it('should handle bulk ZIP files that exceed Discord limits', async () => {
        const largeBulkBuffer = Buffer.alloc(20 * 1024 * 1024); // 20MB
        mockZipArchiveService.createBulkArchive.mockResolvedValue(largeBulkBuffer);
        mockZipArchiveService.isWithinDiscordLimits.mockReturnValue(false);
        mockZipArchiveService.formatBytes.mockReturnValue('20 MB');

        mockContext.args = ['all'];
        await backupCommand.execute(mockContext);

        // Should not send file attachment
        const attachmentCall = mockContext.respond.mock.calls.find(
          call => call[0].files && call[0].files.length > 0
        );
        expect(attachmentCall).toBeUndefined();

        // Should send warning embed
        const warningCall = mockContext.respond.mock.calls.find(
          call => call[0].embeds && call[0].embeds[0].title === '⚠️ File Too Large'
        );
        expect(warningCall).toBeDefined();
        expect(warningCall[0].embeds[0].description).toContain('20 MB');
      });

      it('should handle bulk ZIP creation errors gracefully', async () => {
        mockZipArchiveService.createBulkArchive.mockRejectedValue(
          new Error('Bulk ZIP creation failed')
        );

        mockContext.args = ['all'];
        await backupCommand.execute(mockContext);

        // Should log error
        expect(logger.error).toHaveBeenCalledWith(
          '[BackupCommand] Bulk ZIP creation error: Bulk ZIP creation failed'
        );

        // Should send warning embed
        const warningCall = mockContext.respond.mock.calls.find(
          call => call[0].embeds && call[0].embeds[0].title === '⚠️ Archive Creation Failed'
        );
        expect(warningCall).toBeDefined();
      });
    });

    describe('path construction', () => {
      it('should use correct paths for personality data', async () => {
        mockContext.args = ['TestPersonality'];
        await backupCommand.execute(mockContext);

        expect(mockZipArchiveService.createPersonalityArchive).toHaveBeenCalledWith(
          'testpersonality',
          expect.stringMatching(/data[/\\]personalities[/\\]testpersonality$/)
        );
      });

      it('should handle empty owner personality list', async () => {
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

        const errorCall = mockContext.respond.mock.calls.find(
          call => call[0].embeds && call[0].embeds[0].title === '❌ No Personalities'
        );
        expect(errorCall).toBeDefined();
        expect(mockZipArchiveService.createBulkArchive).not.toHaveBeenCalled();
      });
    });
  });
});
