/**
 * Global auth setup for tests
 * 
 * This file sets up auth mocks globally to handle the removal of NODE_ENV checks
 */

// Mock auth before any modules are loaded
beforeAll(() => {
  // Create a mock auth manager that works in tests
  const mockAuthManager = {
    aiClientFactory: {
      getDefaultClient: jest.fn().mockReturnValue({
        _type: 'mock-openai-client',
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [{
                message: {
                  content: 'Mock AI response'
                }
              }]
            })
          }
        }
      })
    },
    getAIClient: jest.fn().mockResolvedValue({
      _type: 'mock-openai-client',
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{
              message: {
                content: 'Mock AI response'
              }
            }]
          })
        }
      }
    })
  };

  // Mock the auth module globally
  jest.doMock('../src/auth', () => ({
    getAuthManager: jest.fn().mockReturnValue(mockAuthManager),
    hasValidToken: jest.fn().mockReturnValue(true),
    getUserToken: jest.fn().mockReturnValue('mock-token'),
    isNsfwVerified: jest.fn().mockReturnValue(true),
    API_KEY: 'mock-api-key',
    APP_ID: 'mock-app-id',
    initAuth: jest.fn().mockResolvedValue()
  }));
});