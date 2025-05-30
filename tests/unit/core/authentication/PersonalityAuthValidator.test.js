/**
 * Tests for PersonalityAuthValidator
 */

const PersonalityAuthValidator = require('../../../../src/core/authentication/PersonalityAuthValidator');
const { botPrefix } = require('../../../../config');

jest.mock('../../../../src/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

jest.mock('../../../../config', () => ({
  botPrefix: '!tz'
}));

describe('PersonalityAuthValidator', () => {
  let validator;
  let mockNsfwManager;
  let mockTokenManager;
  let logger;
  const ownerId = 'owner123';
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock dependencies
    mockNsfwManager = {
      verifyAccess: jest.fn(),
      requiresNsfwVerification: jest.fn(),
      checkProxySystem: jest.fn(),
      isNsfwVerified: jest.fn(),
      getVerificationInfo: jest.fn()
    };
    
    mockTokenManager = {
      hasValidToken: jest.fn(),
      getTokenExpirationInfo: jest.fn()
    };
    
    logger = require('../../../../src/logger');
    
    validator = new PersonalityAuthValidator(mockNsfwManager, mockTokenManager, ownerId);
  });
  
  describe('Constructor', () => {
    it('should initialize with provided dependencies', () => {
      expect(validator.nsfwVerificationManager).toBe(mockNsfwManager);
      expect(validator.userTokenManager).toBe(mockTokenManager);
      expect(validator.ownerId).toBe(ownerId);
    });
  });
  
  describe('requiresAuth', () => {
    it('should always return true (all personalities require auth)', () => {
      const personality = { requiresAuth: true };
      expect(validator.requiresAuth(personality)).toBe(true);
    });
    
    it('should return true even for personalities marked as not requiring auth', () => {
      const personality = { requiresAuth: false };
      expect(validator.requiresAuth(personality)).toBe(true);
    });
    
    it('should return true for undefined personality', () => {
      expect(validator.requiresAuth(undefined)).toBe(true);
    });
    
    it('should return true for personality without requiresAuth property', () => {
      const personality = { name: 'TestBot' };
      expect(validator.requiresAuth(personality)).toBe(true);
    });
  });
  
  describe('isOwner', () => {
    it('should return true for the owner', () => {
      expect(validator.isOwner(ownerId)).toBe(true);
    });
    
    it('should return false for non-owners', () => {
      expect(validator.isOwner('otherUser')).toBe(false);
    });
    
    it('should handle null/undefined userId', () => {
      expect(validator.isOwner(null)).toBe(false);
      expect(validator.isOwner(undefined)).toBe(false);
    });
  });
  
  describe('validateAccess', () => {
    const mockMessage = {
      author: { id: 'user123' }
    };
    
    const mockPersonality = {
      name: 'TestBot',
      requiresAuth: true
    };
    
    const mockChannel = {
      id: 'channel123',
      guild: { id: 'guild123' },
      nsfw: false
    };
    
    it('should authorize users with valid tokens', async () => {
      mockTokenManager.hasValidToken.mockReturnValue(true);
      mockNsfwManager.verifyAccess.mockReturnValue({ isAllowed: true });
      mockNsfwManager.requiresNsfwVerification.mockReturnValue(false);
      mockNsfwManager.checkProxySystem.mockReturnValue({ isProxy: false });
      
      const result = await validator.validateAccess({
        message: mockMessage,
        personality: mockPersonality,
        channel: mockChannel
      });
      
      expect(result.isAuthorized).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.details.hasValidToken).toBe(true);
    });
    
    it('should reject users without valid tokens', async () => {
      mockTokenManager.hasValidToken.mockReturnValue(false);
      
      const result = await validator.validateAccess({
        message: mockMessage,
        personality: mockPersonality,
        channel: mockChannel
      });
      
      expect(result.isAuthorized).toBe(false);
      expect(result.errors).toContain(`Authentication is required to interact with personalities. Please use \`${botPrefix} auth start\` to authenticate.`);
    });
    
    it('should require auth even for owner', async () => {
      const ownerMessage = { author: { id: ownerId } };
      mockTokenManager.hasValidToken.mockReturnValue(false);
      
      const result = await validator.validateAccess({
        message: ownerMessage,
        personality: mockPersonality,
        channel: mockChannel
      });
      
      expect(result.isAuthorized).toBe(false);
      expect(result.errors).toContain(`Authentication is required to interact with personalities. Please use \`${botPrefix} auth start\` to authenticate.`);
    });
    
    it('should check NSFW verification when required', async () => {
      const nsfwChannel = { ...mockChannel, nsfw: true };
      mockTokenManager.hasValidToken.mockReturnValue(true);
      mockNsfwManager.verifyAccess.mockReturnValue({ isAllowed: false });
      mockNsfwManager.requiresNsfwVerification.mockReturnValue(true);
      
      const result = await validator.validateAccess({
        message: mockMessage,
        personality: mockPersonality,
        channel: nsfwChannel
      });
      
      expect(result.isAuthorized).toBe(false);
      expect(result.errors).toContain('This channel requires age verification. Please use the `verify` command to confirm you are 18 or older.');
      expect(result.requiresNsfwVerification).toBe(true);
    });
    
    it('should handle proxy systems', async () => {
      mockTokenManager.hasValidToken.mockReturnValue(true);
      mockNsfwManager.verifyAccess.mockReturnValue({ 
        isAllowed: true, 
        isProxy: true,
        systemType: 'pluralkit'
      });
      mockNsfwManager.requiresNsfwVerification.mockReturnValue(false);
      mockNsfwManager.checkProxySystem.mockReturnValue({ 
        isProxy: true,
        systemType: 'pluralkit'
      });
      
      const result = await validator.validateAccess({
        message: mockMessage,
        personality: mockPersonality,
        channel: mockChannel
      });
      
      expect(result.isAuthorized).toBe(true);
      expect(result.warnings).toContain('Proxy system detected (pluralkit)');
      expect(result.details.proxySystem).toEqual({
        detected: true,
        type: 'pluralkit'
      });
    });
    
    it('should handle missing userId', async () => {
      const result = await validator.validateAccess({
        message: { author: {} },
        personality: mockPersonality,
        channel: mockChannel
      });
      
      expect(result.isAuthorized).toBe(false);
      expect(result.errors).toContain('Unable to determine user ID');
    });
    
    it('should require auth even for personalities marked as not requiring auth', async () => {
      const openPersonality = { name: 'OpenBot', requiresAuth: false };
      mockTokenManager.hasValidToken.mockReturnValue(false);
      
      const result = await validator.validateAccess({
        message: mockMessage,
        personality: openPersonality,
        channel: mockChannel
      });
      
      expect(result.isAuthorized).toBe(false);
      expect(result.requiresAuth).toBe(true);
      expect(result.errors).toContain(`Authentication is required to interact with personalities. Please use \`${botPrefix} auth start\` to authenticate.`);
      expect(mockTokenManager.hasValidToken).toHaveBeenCalled();
    });
    
    it('should use provided userId over message author id', async () => {
      mockTokenManager.hasValidToken.mockReturnValue(true);
      mockNsfwManager.verifyAccess.mockReturnValue({ isAllowed: true });
      mockNsfwManager.requiresNsfwVerification.mockReturnValue(false);
      mockNsfwManager.checkProxySystem.mockReturnValue({ isProxy: false });
      
      await validator.validateAccess({
        message: mockMessage,
        personality: mockPersonality,
        channel: mockChannel,
        userId: 'providedUser123'
      });
      
      expect(mockTokenManager.hasValidToken).toHaveBeenCalledWith('providedUser123');
    });
  });
  
  describe('getUserAuthStatus', () => {
    it('should return complete auth status for a user', () => {
      const userId = 'user123';
      const tokenInfo = { expiresAt: Date.now() + 3600000 };
      const verificationInfo = { verified: true, verifiedAt: Date.now() };
      
      mockTokenManager.hasValidToken.mockReturnValue(true);
      mockTokenManager.getTokenExpirationInfo.mockReturnValue(tokenInfo);
      mockNsfwManager.isNsfwVerified.mockReturnValue(true);
      mockNsfwManager.getVerificationInfo.mockReturnValue(verificationInfo);
      
      const status = validator.getUserAuthStatus(userId);
      
      expect(status).toEqual({
        userId,
        isOwner: false,
        hasValidToken: true,
        tokenExpiration: tokenInfo,
        nsfwVerified: true,
        nsfwVerificationDate: verificationInfo.verifiedAt
      });
    });
    
    it('should identify owner status', () => {
      mockTokenManager.hasValidToken.mockReturnValue(false);
      mockTokenManager.getTokenExpirationInfo.mockReturnValue(null);
      mockNsfwManager.isNsfwVerified.mockReturnValue(false);
      mockNsfwManager.getVerificationInfo.mockReturnValue(null);
      
      const status = validator.getUserAuthStatus(ownerId);
      
      expect(status.isOwner).toBe(true);
    });
  });
  
  describe('getAuthHelpMessage', () => {
    it('should generate help message for auth failures', () => {
      const validationResult = {
        errors: [`Authentication is required to interact with personalities. Please use \`${botPrefix} auth start\` to authenticate.`],
        warnings: [],
        requiresAuth: true,
        requiresNsfwVerification: false,
        details: {
          hasValidToken: false,
          ownerBypass: false
        }
      };
      
      const message = validator.getAuthHelpMessage(validationResult);
      
      expect(message).toContain('❌ **Authentication Failed**');
      expect(message).toContain('How to authenticate:');
      expect(message).toContain('Use the `auth` command');
    });
    
    it('should generate help message for NSFW failures', () => {
      const validationResult = {
        errors: ['This channel requires age verification.'],
        warnings: [],
        requiresAuth: false,
        requiresNsfwVerification: true,
        details: {
          nsfwCheck: {
            userVerified: false
          }
        }
      };
      
      const message = validator.getAuthHelpMessage(validationResult);
      
      expect(message).toContain('Age verification required:');
      expect(message).toContain('Use the `verify` command');
    });
    
    it('should include warnings in help message', () => {
      const validationResult = {
        errors: [],
        warnings: ['Authentication through proxy systems may have limitations'],
        requiresAuth: false,
        requiresNsfwVerification: false,
        details: {}
      };
      
      const message = validator.getAuthHelpMessage(validationResult);
      
      expect(message).toContain('**Warnings:**');
      expect(message).toContain('⚠️ Authentication through proxy systems');
    });
    
    it('should handle empty validation result', () => {
      const validationResult = {
        errors: [],
        warnings: [],
        requiresAuth: false,
        requiresNsfwVerification: false,
        details: {}
      };
      
      const message = validator.getAuthHelpMessage(validationResult);
      
      expect(message).toBe('');
    });
  });
});