const PersonalityValidator = require('../../../../src/core/personality/PersonalityValidator');

describe('PersonalityValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new PersonalityValidator();
  });

  describe('validatePersonalityData', () => {
    it('should validate valid personality data', () => {
      const data = {
        fullName: 'test-personality',
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
        displayName: 'Test',
        avatarUrl: 'https://example.com/avatar.png',
        activatedChannels: ['channel1', 'channel2'],
      };

      const result = validator.validatePersonalityData(data);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid personality data', () => {
      const result = validator.validatePersonalityData(null);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Personality data must be an object');
    });

    it('should require fullName', () => {
      const data = {
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
      };

      const result = validator.validatePersonalityData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('fullName is required and must be a string');
    });

    it('should require addedBy', () => {
      const data = {
        fullName: 'test-personality',
        addedAt: new Date().toISOString(),
      };

      const result = validator.validatePersonalityData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('addedBy is required and must be a string');
    });

    it('should validate optional field types', () => {
      const data = {
        fullName: 'test-personality',
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
        displayName: 123, // Should be string
        avatarUrl: true, // Should be string
        activatedChannels: 'not-array', // Should be array
      };

      const result = validator.validatePersonalityData(data);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('displayName must be a string if provided');
      expect(result.errors).toContain('avatarUrl must be a string if provided');
      expect(result.errors).toContain('activatedChannels must be an array if provided');
    });
  });

  describe('validatePersonalityName', () => {
    it('should validate valid names', () => {
      const validNames = ['claude-3-opus', 'Assistant_2024', 'Test Personality', 'Bot.v1', 'AI'];

      validNames.forEach(name => {
        const result = validator.validatePersonalityName(name);
        expect(result.isValid).toBe(true);
      });
    });

    it('should reject empty or invalid names', () => {
      expect(validator.validatePersonalityName('').isValid).toBe(false);
      expect(validator.validatePersonalityName(null).isValid).toBe(false);
      expect(validator.validatePersonalityName(123).isValid).toBe(false);
    });

    it('should reject names with leading/trailing spaces', () => {
      const result = validator.validatePersonalityName('  test  ');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('leading or trailing spaces');
    });

    it('should reject names that are too short or too long', () => {
      expect(validator.validatePersonalityName('a').isValid).toBe(false);
      expect(validator.validatePersonalityName('a'.repeat(101)).isValid).toBe(false);
    });

    it('should reject names with invalid characters', () => {
      const result = validator.validatePersonalityName('test@personality!');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('invalid characters');
    });
  });

  describe('validateAlias', () => {
    it('should validate valid aliases', () => {
      const validAliases = ['test', 'Test123', 'my-alias', 'alias_1'];

      validAliases.forEach(alias => {
        const result = validator.validateAlias(alias);
        expect(result.isValid).toBe(true);
      });
    });

    it('should reject invalid aliases', () => {
      expect(validator.validateAlias('').isValid).toBe(false);
      expect(validator.validateAlias(null).isValid).toBe(false);
      expect(validator.validateAlias('  alias  ').isValid).toBe(false);
      expect(validator.validateAlias('a'.repeat(51)).isValid).toBe(false);
    });
  });

  describe('validateUserId', () => {
    it('should validate valid Discord user IDs', () => {
      const validIds = ['123456789012345678', '987654321098765432'];

      validIds.forEach(id => {
        const result = validator.validateUserId(id);
        expect(result.isValid).toBe(true);
      });
    });

    it('should reject invalid user IDs', () => {
      expect(validator.validateUserId('').isValid).toBe(false);
      expect(validator.validateUserId(null).isValid).toBe(false);
      expect(validator.validateUserId(123).isValid).toBe(false);
      // Non-numeric strings are now valid (support for test IDs)
      expect(validator.validateUserId('test-user').isValid).toBe(true);
    });
  });

  describe('isReservedName', () => {
    it('should identify reserved names', () => {
      const reservedNames = ['system', 'bot', 'admin', 'null', 'undefined'];

      reservedNames.forEach(name => {
        expect(validator.isReservedName(name)).toBe(true);
      });
    });

    it('should be case-insensitive', () => {
      expect(validator.isReservedName('SYSTEM')).toBe(true);
      expect(validator.isReservedName('Bot')).toBe(true);
      expect(validator.isReservedName('ADMIN')).toBe(true);
    });

    it('should not flag non-reserved names', () => {
      expect(validator.isReservedName('claude')).toBe(false);
      expect(validator.isReservedName('assistant')).toBe(false);
    });
  });

  describe('validateRegistration', () => {
    const existingPersonalities = new Map([
      ['existing-personality', { fullName: 'existing-personality' }],
    ]);

    it('should validate valid registration', () => {
      const personalityData = {
        fullName: 'new-personality',
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
      };

      const result = validator.validateRegistration(
        'new-personality',
        personalityData,
        existingPersonalities
      );

      expect(result.isValid).toBe(true);
    });

    it('should reject if name already exists', () => {
      const personalityData = {
        fullName: 'existing-personality',
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
      };

      const result = validator.validateRegistration(
        'existing-personality',
        personalityData,
        existingPersonalities
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should reject reserved names', () => {
      const personalityData = {
        fullName: 'system',
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
      };

      const result = validator.validateRegistration(
        'system',
        personalityData,
        existingPersonalities
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('reserved');
    });

    it('should reject if fullName mismatch', () => {
      const personalityData = {
        fullName: 'different-name',
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
      };

      const result = validator.validateRegistration(
        'new-personality',
        personalityData,
        existingPersonalities
      );

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('must match');
    });
  });

  describe('validateRemoval', () => {
    const personality = {
      fullName: 'test-personality',
      addedBy: '123456789',
      addedAt: new Date().toISOString(),
    };

    it('should allow owner to remove their personality', () => {
      const result = validator.validateRemoval('test-personality', '123456789', personality);

      expect(result.isValid).toBe(true);
    });

    it('should prevent non-owner from removing personality', () => {
      const result = validator.validateRemoval('test-personality', '987654321', personality);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('you added');
    });

    it('should reject if personality not found', () => {
      const result = validator.validateRemoval('non-existent', '123456789', null);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should allow bot owner to remove any personality', () => {
      process.env.BOT_OWNER_ID = '999999999';

      const result = validator.validateRemoval('test-personality', '999999999', personality);

      expect(result.isValid).toBe(true);

      delete process.env.BOT_OWNER_ID;
    });
  });

  describe('sanitizePersonalityData', () => {
    it('should trim string fields', () => {
      const data = {
        fullName: '  test-personality  ',
        displayName: '  Test  ',
        avatarUrl: '  https://example.com/avatar.png  ',
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
      };

      const sanitized = validator.sanitizePersonalityData(data);

      expect(sanitized.fullName).toBe('test-personality');
      expect(sanitized.displayName).toBe('Test');
      expect(sanitized.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should ensure arrays are arrays', () => {
      const data = {
        fullName: 'test-personality',
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
        activatedChannels: 'not-an-array',
      };

      const sanitized = validator.sanitizePersonalityData(data);

      expect(Array.isArray(sanitized.activatedChannels)).toBe(true);
      expect(sanitized.activatedChannels).toHaveLength(0);
    });

    it('should remove unexpected fields', () => {
      const data = {
        fullName: 'test-personality',
        addedBy: '123456789',
        addedAt: new Date().toISOString(),
        unexpectedField: 'should be removed',
        anotherField: 123,
      };

      const sanitized = validator.sanitizePersonalityData(data);

      expect(sanitized.unexpectedField).toBeUndefined();
      expect(sanitized.anotherField).toBeUndefined();
    });
  });
});
