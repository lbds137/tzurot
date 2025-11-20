/**
 * Unit tests for BlacklistEventHandlers
 */

const {
  createUserBlacklistedGloballyHandler,
  createUserUnblacklistedGloballyHandler
} = require('../../../../src/application/eventHandlers/BlacklistEventHandlers');
const { UserBlacklistedGlobally, UserUnblacklistedGlobally } = require('../../../../src/domain/blacklist');
const { UserAuth } = require('../../../../src/domain/authentication/UserAuth');

describe('BlacklistEventHandlers', () => {
  let mockAuthRepository;
  let mockConversationManager;
  let mockUserAuth;
  
  beforeEach(() => {
    // Create mock user auth
    mockUserAuth = {
      isAuthenticated: jest.fn(),
      expireToken: jest.fn()
    };
    
    // Create mock auth repository
    mockAuthRepository = {
      findByUserId: jest.fn(),
      save: jest.fn()
    };
    
    // Create mock conversation manager
    mockConversationManager = {
      clearUserConversations: jest.fn()
    };
  });
  
  describe('UserBlacklistedGloballyHandler', () => {
    let handler;
    
    beforeEach(() => {
      handler = createUserBlacklistedGloballyHandler({
        authenticationRepository: mockAuthRepository,
        conversationManager: mockConversationManager
      });
    });
    
    it('should expire user token when blacklisted', async () => {
      const event = new UserBlacklistedGlobally('123456789', {
        userId: '123456789',
        reason: 'Spamming',
        blacklistedBy: '987654321',
        blacklistedAt: new Date().toISOString()
      });
      
      mockUserAuth.isAuthenticated.mockReturnValue(true);
      mockAuthRepository.findByUserId.mockResolvedValue(mockUserAuth);
      mockAuthRepository.save.mockResolvedValue();
      
      await handler(event);
      
      expect(mockAuthRepository.findByUserId).toHaveBeenCalledWith('123456789');
      expect(mockUserAuth.expireToken).toHaveBeenCalled();
      expect(mockAuthRepository.save).toHaveBeenCalledWith(mockUserAuth);
    });
    
    it('should not expire token if user not authenticated', async () => {
      const event = new UserBlacklistedGlobally('123456789', {
        userId: '123456789',
        reason: 'Spamming',
        blacklistedBy: '987654321',
        blacklistedAt: new Date().toISOString()
      });
      
      mockUserAuth.isAuthenticated.mockReturnValue(false);
      mockAuthRepository.findByUserId.mockResolvedValue(mockUserAuth);
      
      await handler(event);
      
      expect(mockAuthRepository.findByUserId).toHaveBeenCalledWith('123456789');
      expect(mockUserAuth.expireToken).not.toHaveBeenCalled();
      expect(mockAuthRepository.save).not.toHaveBeenCalled();
    });
    
    it('should handle case when user auth not found', async () => {
      const event = new UserBlacklistedGlobally('123456789', {
        userId: '123456789',
        reason: 'Spamming',
        blacklistedBy: '987654321',
        blacklistedAt: new Date().toISOString()
      });
      
      mockAuthRepository.findByUserId.mockResolvedValue(null);
      
      await handler(event);
      
      expect(mockAuthRepository.findByUserId).toHaveBeenCalledWith('123456789');
      expect(mockAuthRepository.save).not.toHaveBeenCalled();
    });
    
    it('should clear user conversations when blacklisted', async () => {
      const event = new UserBlacklistedGlobally('123456789', {
        userId: '123456789',
        reason: 'Spamming',
        blacklistedBy: '987654321',
        blacklistedAt: new Date().toISOString()
      });
      
      mockAuthRepository.findByUserId.mockResolvedValue(null);
      
      await handler(event);
      
      expect(mockConversationManager.clearUserConversations).toHaveBeenCalledWith('123456789');
    });
    
    it('should handle errors gracefully without throwing', async () => {
      const event = new UserBlacklistedGlobally('123456789', {
        userId: '123456789',
        reason: 'Spamming',
        blacklistedBy: '987654321',
        blacklistedAt: new Date().toISOString()
      });
      
      mockAuthRepository.findByUserId.mockRejectedValue(new Error('Database error'));
      
      // Should not throw
      await expect(handler(event)).resolves.not.toThrow();
    });
    
    it('should handle missing conversation manager', async () => {
      const handlerWithoutConversation = createUserBlacklistedGloballyHandler({
        authenticationRepository: mockAuthRepository,
        conversationManager: null
      });
      
      const event = new UserBlacklistedGlobally('123456789', {
        userId: '123456789',
        reason: 'Spamming',
        blacklistedBy: '987654321',
        blacklistedAt: new Date().toISOString()
      });
      
      mockAuthRepository.findByUserId.mockResolvedValue(null);
      
      // Should not throw
      await expect(handlerWithoutConversation(event)).resolves.not.toThrow();
    });
  });
  
  describe('UserUnblacklistedGloballyHandler', () => {
    let handler;
    
    beforeEach(() => {
      handler = createUserUnblacklistedGloballyHandler({
        authenticationRepository: mockAuthRepository,
        conversationManager: mockConversationManager
      });
    });
    
    it('should log unblacklist event', async () => {
      const event = new UserUnblacklistedGlobally('123456789', {
        userId: '123456789',
        unblacklistedBy: '987654321',
        unblacklistedAt: new Date().toISOString(),
        previousReason: 'Spamming'
      });
      
      // Should not throw and just log
      await expect(handler(event)).resolves.not.toThrow();
    });
    
    it('should handle errors gracefully', async () => {
      const event = new UserUnblacklistedGlobally('123456789', {
        userId: '123456789',
        unblacklistedBy: '987654321',
        unblacklistedAt: new Date().toISOString(),
        previousReason: 'Spamming'
      });
      
      // Mock console.error to throw
      const originalError = console.error;
      console.error = jest.fn(() => {
        throw new Error('Logging failed');
      });
      
      // Should not throw
      await expect(handler(event)).resolves.not.toThrow();
      
      // Restore console.error
      console.error = originalError;
    });
  });
});