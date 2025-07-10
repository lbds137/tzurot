describe('Pluralkit Authentication Integration', () => {
  let personalityAuth;
  let webhookUserTracker; 
  let authManager;
  let mockLogger;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };
    
    jest.doMock('../../../src/logger', () => mockLogger);
    
    // Mock auth manager
    authManager = {
      validatePersonalityAccess: jest.fn(),
      personalityAuthValidator: {
        requiresAuth: jest.fn()
      },
      nsfwVerificationManager: {
        requiresNsfwVerification: jest.fn()
      },
      getUserAuthStatus: jest.fn()
    };
    
    // Load modules after mocking
    personalityAuth = require('../../../src/utils/personalityAuth');
    webhookUserTracker = require('../../../src/utils/webhookUserTracker');
    
    // Initialize with mock auth manager
    personalityAuth.initialize(authManager);
  });
  
  it('should use real user ID for Pluralkit webhook authentication', async () => {
    // Mock a Pluralkit webhook message
    const pluralkitMessage = {
      id: 'pk-msg-123',
      webhookId: 'pk-webhook-456',
      author: {
        bot: true,
        id: 'pk-webhook-user-789',
        username: 'Lila | System'
      },
      content: 'Hello personality!',
      channel: {
        id: 'channel-123',
        isDMBased: () => false
      }
    };
    
    const personality = {
      fullName: 'test-personality',
      requiresAuth: true
    };
    
    // Mock webhookUserTracker to return the real user ID
    jest.spyOn(webhookUserTracker, 'getRealUserId').mockReturnValue('real-user-123');
    
    // Mock auth manager to return success
    authManager.validatePersonalityAccess.mockResolvedValue({
      isAuthorized: true,
      errors: [],
      details: {
        proxySystem: { detected: true },
        nsfwCheck: { channelRequiresVerification: false }
      }
    });
    
    // Check personality auth
    const result = await personalityAuth.checkPersonalityAuth(pluralkitMessage, personality);
    
    // Verify it used the real user ID for auth
    expect(authManager.validatePersonalityAccess).toHaveBeenCalledWith({
      message: pluralkitMessage,
      personality: personality,
      channel: pluralkitMessage.channel,
      userId: 'real-user-123' // Should use real user ID, not webhook ID
    });
    
    // Verify the result
    expect(result.isAllowed).toBe(true);
    expect(result.authUserId).toBe('real-user-123');
    expect(result.isProxySystem).toBe(true);
  });
  
  it('should deny access when real user lacks authentication', async () => {
    const pluralkitMessage = {
      id: 'pk-msg-123',
      webhookId: 'pk-webhook-456',
      author: {
        bot: true,
        id: 'pk-webhook-user-789',
        username: 'Lila | System'
      },
      content: 'Hello personality!',
      channel: {
        id: 'channel-123',
        isDMBased: () => false
      }
    };
    
    const personality = {
      fullName: 'test-personality',
      requiresAuth: true
    };
    
    // Mock webhookUserTracker to return real user ID
    jest.spyOn(webhookUserTracker, 'getRealUserId').mockReturnValue('real-user-123');
    
    // Mock auth manager to return failure
    authManager.validatePersonalityAccess.mockResolvedValue({
      isAuthorized: false,
      errors: ['Authentication required to interact with test-personality'],
      details: {}
    });
    
    // Check personality auth
    const result = await personalityAuth.checkPersonalityAuth(pluralkitMessage, personality);
    
    // Verify it denied access
    expect(result.isAllowed).toBe(false);
    expect(result.errorMessage).toContain('Authentication required');
    expect(result.reason).toBe('auth_failed');
  });
});