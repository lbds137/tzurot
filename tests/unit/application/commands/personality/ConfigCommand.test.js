/**
 * Tests for ConfigCommand
 */

const { createConfigCommand } = require('../../../../../src/application/commands/personality/ConfigCommand');

describe('ConfigCommand', () => {
  let command;
  let mockPersonalityService;
  let mockContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock personality service
    mockPersonalityService = {
      getPersonality: jest.fn(),
      checkPermission: jest.fn(),
      updatePersonality: jest.fn(),
    };

    // Mock context
    mockContext = {
      userId: 'test-user-123',
      reply: jest.fn(),
      args: [],
      isSlashCommand: false,
      dependencies: {
        personalityApplicationService: mockPersonalityService,
      },
    };

    command = createConfigCommand();
  });

  describe('Text command usage', () => {
    it('should show usage help when insufficient arguments provided', async () => {
      mockContext.args = ['alice']; // Missing setting and value

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'How to Configure Personality Settings',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Available Settings',
                value: expect.stringContaining('context-metadata'),
              }),
            ]),
          }),
        ],
      });
    });

    it('should show error for invalid setting', async () => {
      mockContext.args = ['alice', 'invalid-setting', 'on'];

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'Invalid Setting',
            description: '"invalid-setting" is not a valid setting.',
          }),
        ],
      });
    });

    it('should show error for invalid value', async () => {
      mockContext.args = ['alice', 'context-metadata', 'invalid-value'];

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'Invalid Value',
            description: '"invalid-value" is not a valid value. Use "on" or "off".',
          }),
        ],
      });
    });

    it('should show error when personality not found', async () => {
      mockContext.args = ['nonexistent', 'context-metadata', 'off'];
      mockPersonalityService.getPersonality.mockResolvedValue(null);

      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('nonexistent');
      expect(mockContext.reply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'Personality Not Found',
            description: 'Could not find a personality named "nonexistent".',
          }),
        ],
      });
    });

    it('should successfully disable context metadata', async () => {
      mockContext.args = ['alice', 'context-metadata', 'off'];

      const mockPersonality = {
        id: 'personality-123',
        name: 'alice',
        profile: { displayName: 'Alice' },
      };

      mockPersonalityService.getPersonality.mockResolvedValue(mockPersonality);
      mockPersonalityService.checkPermission.mockResolvedValue(true);
      mockPersonalityService.updatePersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('alice');
      expect(mockPersonalityService.checkPermission).toHaveBeenCalledWith({
        userId: 'test-user-123',
        personalityName: 'alice',
      });
      expect(mockPersonalityService.updatePersonality).toHaveBeenCalledWith('personality-123', {
        disableContextMetadata: true,
      });
      expect(mockContext.reply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'Setting Updated',
            description: 'Updated setting for **Alice**.',
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Setting',
                value: '`context-metadata`',
              }),
              expect.objectContaining({
                name: 'Value',
                value: '`off`',
              }),
              expect.objectContaining({
                name: 'Effect',
                value: 'Context metadata (server/channel info) has been **disabled**',
              }),
            ]),
          }),
        ],
      });
    });

    it('should successfully enable context metadata', async () => {
      mockContext.args = ['alice', 'context-metadata', 'on'];

      const mockPersonality = {
        id: 'personality-123',
        name: 'alice',
        profile: { displayName: 'Alice' },
      };

      mockPersonalityService.getPersonality.mockResolvedValue(mockPersonality);
      mockPersonalityService.checkPermission.mockResolvedValue(true);
      mockPersonalityService.updatePersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('alice');
      expect(mockPersonalityService.checkPermission).toHaveBeenCalledWith({
        userId: 'test-user-123',
        personalityName: 'alice',
      });
      expect(mockPersonalityService.updatePersonality).toHaveBeenCalledWith('personality-123', {
        disableContextMetadata: false,
      });
      expect(mockContext.reply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            fields: expect.arrayContaining([
              expect.objectContaining({
                name: 'Effect',
                value: 'Context metadata (server/channel info) has been **enabled**',
              }),
            ]),
          }),
        ],
      });
    });

    it('should handle alternative boolean values', async () => {
      const testCases = [
        { input: 'true', expected: false },
        { input: 'false', expected: true },
        { input: 'enable', expected: false },
        { input: 'disable', expected: true },
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();
        mockContext.args = ['alice', 'context-metadata', testCase.input];

        const mockPersonality = {
          id: 'personality-123',
          name: 'alice',
          profile: { displayName: 'Alice' },
        };

        mockPersonalityService.getPersonality.mockResolvedValue(mockPersonality);
        mockPersonalityService.checkPermission.mockResolvedValue(true);
        mockPersonalityService.updatePersonality.mockResolvedValue(mockPersonality);

        await command.execute(mockContext);

        expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('alice');
        expect(mockPersonalityService.checkPermission).toHaveBeenCalledWith({
          userId: 'test-user-123',
          personalityName: 'alice',
        });
        expect(mockPersonalityService.updatePersonality).toHaveBeenCalledWith('personality-123', {
          disableContextMetadata: testCase.expected,
        });
      }
    });
  });

  describe('Slash command usage', () => {
    it('should work with slash command options', async () => {
      mockContext.isSlashCommand = true;
      mockContext.options = {
        name: 'alice',
        setting: 'context-metadata',
        value: 'off',
      };

      const mockPersonality = {
        id: 'personality-123',
        name: 'alice',
        profile: { displayName: 'Alice' },
      };

      mockPersonalityService.getPersonality.mockResolvedValue(mockPersonality);
      mockPersonalityService.checkPermission.mockResolvedValue(true);
      mockPersonalityService.updatePersonality.mockResolvedValue(mockPersonality);

      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('alice');
      expect(mockPersonalityService.checkPermission).toHaveBeenCalledWith({
        userId: 'test-user-123',
        personalityName: 'alice',
      });
      expect(mockPersonalityService.updatePersonality).toHaveBeenCalledWith('personality-123', {
        disableContextMetadata: true,
      });
    });

    it('should show error when user lacks permission', async () => {
      mockContext.args = ['alice', 'context-metadata', 'off'];

      const mockPersonality = {
        id: 'personality-123',
        name: 'alice',
        profile: { displayName: 'Alice' },
      };

      mockPersonalityService.getPersonality.mockResolvedValue(mockPersonality);
      mockPersonalityService.checkPermission.mockResolvedValue(false);

      await command.execute(mockContext);

      expect(mockPersonalityService.getPersonality).toHaveBeenCalledWith('alice');
      expect(mockPersonalityService.checkPermission).toHaveBeenCalledWith({
        userId: 'test-user-123',
        personalityName: 'alice',
      });
      expect(mockContext.reply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'Permission Denied',
            description: 'You don\'t have permission to configure "alice".',
          }),
        ],
      });
    });
  });

  describe('Error handling', () => {
    it('should handle missing personality service', async () => {
      mockContext.dependencies.personalityApplicationService = null;

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'Command Error',
            description: 'An error occurred while processing the configuration command.',
          }),
        ],
      });
    });

    it('should handle update errors', async () => {
      mockContext.args = ['alice', 'context-metadata', 'off'];

      const mockPersonality = {
        id: 'personality-123',
        name: 'alice',
        profile: { displayName: 'Alice' },
      };

      mockPersonalityService.getPersonality.mockResolvedValue(mockPersonality);
      mockPersonalityService.checkPermission.mockResolvedValue(true);
      mockPersonalityService.updatePersonality.mockRejectedValue(new Error('Update failed'));

      await command.execute(mockContext);

      expect(mockContext.reply).toHaveBeenCalledWith({
        embeds: [
          expect.objectContaining({
            title: 'Configuration Error',
            description: 'Failed to update the personality configuration. Please try again.',
          }),
        ],
      });
    });
  });

  describe('Command metadata', () => {
    it('should have correct command metadata', () => {
      expect(command.name).toBe('config');
      expect(command.description).toBe('Configure settings for a personality');
      expect(command.category).toBe('personality');
      expect(command.aliases).toEqual(['configure', 'settings']);
      expect(command.permissions).toEqual(['USER']);
    });

    it('should have correct command options', () => {
      expect(command.options).toHaveLength(3);

      const nameOption = command.options.find(opt => opt.name === 'name');
      expect(nameOption).toBeDefined();
      expect(nameOption.required).toBe(true);

      const settingOption = command.options.find(opt => opt.name === 'setting');
      expect(settingOption).toBeDefined();
      expect(settingOption.required).toBe(true);
      expect(settingOption.choices).toEqual([{ name: 'context-metadata', value: 'context-metadata' }]);

      const valueOption = command.options.find(opt => opt.name === 'value');
      expect(valueOption).toBeDefined();
      expect(valueOption.required).toBe(true);
      expect(valueOption.choices).toEqual([
        { name: 'on', value: 'on' },
        { name: 'off', value: 'off' },
      ]);
    });
  });
});