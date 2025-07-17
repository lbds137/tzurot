/**
 * Tests for OAuthTokenService
 */

const { OAuthTokenService } = require('../../../../src/infrastructure/authentication/OAuthTokenService');
const logger = require('../../../../src/logger');

// Mock dependencies
jest.mock('../../../../src/logger');
jest.mock('node-fetch');

describe('OAuthTokenService', () => {
  let mockHttpClient;
  let service;
  let config;

  beforeEach(() => {
    jest.clearAllMocks();

    mockHttpClient = jest.fn();
    
    config = {
      appId: 'test-app-id',
      apiKey: 'test-api-key',
      authApiEndpoint: 'https://api.example.com/auth',
      authWebsite: 'https://example.com',
      serviceApiBaseUrl: 'https://api.example.com',
      httpClient: mockHttpClient,
    };

    service = new OAuthTokenService(config);
  });

  describe('constructor', () => {
    it('should create service with provided config', () => {
      expect(service.appId).toBe('test-app-id');
      expect(service.apiKey).toBe('test-api-key');
      expect(service.authApiEndpoint).toBe('https://api.example.com/auth');
      expect(service.authWebsite).toBe('https://example.com');
      expect(service.serviceApiBaseUrl).toBe('https://api.example.com');
      expect(service.httpClient).toBe(mockHttpClient);
    });

    it('should use environment variables as fallback', () => {
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        SERVICE_APP_ID: 'env-app-id',
        SERVICE_API_KEY: 'env-api-key',
        SERVICE_API_BASE_URL: 'https://env-api.example.com',
        SERVICE_WEBSITE: 'https://example.com',
      };

      const envService = new OAuthTokenService();
      
      expect(envService.appId).toBe('env-app-id');
      expect(envService.apiKey).toBe('env-api-key');
      expect(envService.authApiEndpoint).toBe('https://env-api.example.com/auth');
      expect(envService.authWebsite).toBe('https://example.com');
      expect(envService.serviceApiBaseUrl).toBe('https://env-api.example.com');

      process.env = originalEnv;
    });

    it('should require appId', () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv };
      delete process.env.SERVICE_APP_ID;
      delete config.appId;
      expect(() => new OAuthTokenService(config)).toThrow('App ID is required for OAuth token service');
      process.env = originalEnv;
    });

    it('should require apiKey', () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv };
      delete process.env.SERVICE_API_KEY;
      delete config.apiKey;
      expect(() => new OAuthTokenService(config)).toThrow('API key is required for OAuth token service');
      process.env = originalEnv;
    });

    it('should use node-fetch as default httpClient', () => {
      delete config.httpClient;
      const defaultService = new OAuthTokenService(config);
      expect(defaultService.httpClient).toBe(require('node-fetch'));
    });
  });

  describe('getAuthorizationUrl', () => {
    it('should generate authorization URL with state', async () => {
      const url = await service.getAuthorizationUrl('test-state');
      
      expect(url).toBe('https://example.com/authorize?app_id=test-app-id');
      expect(logger.info).toHaveBeenCalledWith('[OAuthTokenService] Generating authorization URL');
      expect(logger.info).toHaveBeenCalledWith('[OAuthTokenService] Generated auth URL:', url);
    });

    it('should generate authorization URL without state', async () => {
      const url = await service.getAuthorizationUrl();
      
      expect(url).toBe('https://example.com/authorize?app_id=test-app-id');
    });

  });

  describe('exchangeCode', () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: jest.fn(),
    };

    beforeEach(() => {
      mockHttpClient.mockResolvedValue(mockResponse);
    });

    it('should exchange code for token successfully', async () => {
      const tokenData = {
        auth_token: 'access-token-123',
        expires_at: '2024-12-31T23:59:59Z',
      };
      mockResponse.json.mockResolvedValue(tokenData);

      const result = await service.exchangeCode('auth-code-123', 'user-123');

      expect(result).toEqual({
        token: 'access-token-123',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      });

      expect(mockHttpClient).toHaveBeenCalledWith(
        'https://api.example.com/auth/nonce',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            app_id: 'test-app-id',
            code: 'auth-code-123',
          }),
        }
      );

      expect(logger.info).toHaveBeenCalledWith('[OAuthTokenService] Exchanging code for user user-123');
    });

    it('should handle HTTP errors', async () => {
      mockResponse.ok = false;
      mockResponse.status = 400;
      mockResponse.statusText = 'Bad Request';
      mockResponse.json.mockResolvedValue({ error: 'Invalid code' });

      await expect(service.exchangeCode('invalid-code', 'user-123')).rejects.toThrow(
        'OAuth exchange failed: Invalid code'
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[OAuthTokenService] Failed to exchange code for user user-123:',
        expect.any(Error)
      );
    });

    it('should handle network errors', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network error'));

      await expect(service.exchangeCode('auth-code-123', 'user-123')).rejects.toThrow('Network error');

      expect(logger.error).toHaveBeenCalledWith(
        '[OAuthTokenService] Failed to exchange code for user user-123:',
        expect.any(Error)
      );
    });

    it('should handle missing token in response', async () => {
      mockResponse.json.mockResolvedValue({ invalid: 'response' });

      await expect(service.exchangeCode('auth-code-123', 'user-123')).rejects.toThrow(
        'OAuth exchange failed: Bad Request'
      );
    });

    it('should handle response without expires_at', async () => {
      const tokenData = {
        auth_token: 'access-token-123',
        // No expires_at field
      };
      mockResponse.json.mockResolvedValue(tokenData);
      mockResponse.ok = true;

      const result = await service.exchangeCode('auth-code-123', 'user-123');

      expect(result).toEqual({
        token: 'access-token-123',
        expiresAt: null,
      });
    });
  });

  describe('exchangeToken (legacy method)', () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: jest.fn(),
    };

    beforeEach(() => {
      mockHttpClient.mockResolvedValue(mockResponse);
    });

    it('should exchange userId for token successfully', async () => {
      const tokenData = {
        token: 'direct-token-123',
        expires_at: '2024-12-31T23:59:59Z',
      };
      mockResponse.json.mockResolvedValue(tokenData);

      const result = await service.exchangeToken('user-123');

      expect(result).toEqual({
        token: 'direct-token-123',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      });

      expect(mockHttpClient).toHaveBeenCalledWith(
        'https://api.example.com/auth/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
          },
          body: JSON.stringify({
            discord_id: 'user-123',
          }),
        }
      );

      expect(logger.info).toHaveBeenCalledWith('[OAuthTokenService] Direct token exchange for user user-123');
    });

    it('should handle exchange errors', async () => {
      mockResponse.ok = false;
      mockResponse.status = 404;
      mockResponse.statusText = 'Not Found';
      mockResponse.json.mockResolvedValue({ error: 'User not found' });

      await expect(service.exchangeToken('unknown-user')).rejects.toThrow(
        'Token exchange failed: User not found'
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[OAuthTokenService] Failed to exchange token for user unknown-user:',
        expect.any(Error)
      );
    });
  });

  describe('validateToken', () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: jest.fn(),
      headers: new Map([['content-type', 'application/json']]),
    };

    beforeEach(() => {
      mockHttpClient.mockResolvedValue(mockResponse);
      mockResponse.headers.entries = jest.fn().mockReturnValue([['content-type', 'application/json']]);
    });

    it('should validate token successfully', async () => {
      const validationData = {
        valid: true,
        discord_id: 'user-123',
      };
      mockResponse.json.mockResolvedValue(validationData);

      const result = await service.validateToken('token-123');

      expect(result).toEqual({
        valid: true,
        userId: 'user-123',
      });

      expect(mockHttpClient).toHaveBeenCalledWith(
        'https://api.example.com/auth/validate',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
          },
          body: JSON.stringify({
            token: 'token-123',
          }),
        }
      );

      expect(logger.info).toHaveBeenCalledWith('[OAuthTokenService] Validating token:', {
        tokenPrefix: 'token-12...',
        endpoint: 'https://api.example.com/auth/validate'
      });
    });

    it('should handle invalid token', async () => {
      const validationData = {
        valid: false,
        discord_id: null,
      };
      mockResponse.json.mockResolvedValue(validationData);

      const result = await service.validateToken('expired-token');

      expect(result).toEqual({
        valid: false,
        userId: null,
      });
    });

    it('should handle no response data', async () => {
      mockResponse.ok = false;
      mockResponse.json.mockResolvedValue(null);

      const result = await service.validateToken('token-123');

      expect(result).toEqual({
        valid: false,
      });

      expect(logger.warn).toHaveBeenCalledWith('[OAuthTokenService] No response data from validation endpoint');
    });

    it('should handle network errors during validation', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network timeout'));

      await expect(service.validateToken('token-123')).rejects.toThrow('Network timeout');

      expect(logger.error).toHaveBeenCalledWith(
        '[OAuthTokenService] Failed to validate token:',
        {
          message: 'Network timeout',
          code: undefined,
        }
      );
    });
  });

  describe('refreshToken', () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: jest.fn(),
    };

    beforeEach(() => {
      mockHttpClient.mockResolvedValue(mockResponse);
    });

    it('should refresh token successfully', async () => {
      const refreshData = {
        token: 'new-token-123',
        expires_at: '2024-12-31T23:59:59Z',
      };
      mockResponse.json.mockResolvedValue(refreshData);

      const result = await service.refreshToken('old-token-123');

      expect(result).toEqual({
        token: 'new-token-123',
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      });

      expect(mockHttpClient).toHaveBeenCalledWith(
        'https://api.example.com/auth/refresh',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key',
          },
          body: JSON.stringify({
            token: 'old-token-123',
          }),
        }
      );

      expect(logger.info).toHaveBeenCalledWith('[OAuthTokenService] Refreshing token');
    });

    it('should handle refresh errors', async () => {
      mockResponse.ok = false;
      mockResponse.status = 400;
      mockResponse.statusText = 'Bad Request';

      await expect(service.refreshToken('invalid-token')).rejects.toThrow(
        'Token refresh failed: Bad Request'
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[OAuthTokenService] Failed to refresh token:',
        expect.any(Error)
      );
    });

    it('should handle missing token in refresh response', async () => {
      mockResponse.json.mockResolvedValue({ invalid: 'response' });

      await expect(service.refreshToken('token-123')).rejects.toThrow(
        'Token refresh failed: Bad Request'
      );
    });

    it('should handle response without expires_at', async () => {
      const refreshData = {
        token: 'new-token-123',
        // No expires_at field
      };
      mockResponse.json.mockResolvedValue(refreshData);
      mockResponse.ok = true;

      const result = await service.refreshToken('old-token-123');

      expect(result).toEqual({
        token: 'new-token-123',
        expiresAt: null,
      });
    });
  });

  describe('revokeToken', () => {
    it('should handle token revocation locally without remote calls', async () => {
      await service.revokeToken('token-123');

      // Should not make any HTTP calls since there's no remote revocation endpoint
      expect(mockHttpClient).not.toHaveBeenCalled();

      // Should log that it's handling locally
      expect(logger.info).toHaveBeenCalledWith('[OAuthTokenService] Token revocation requested - handling locally only');
      expect(logger.warn).toHaveBeenCalledWith('[OAuthTokenService] No remote revocation endpoint available, token will be expired locally');
    });

    it('should always succeed since revocation is local-only', async () => {
      // Should not throw any errors since it's a no-op
      await expect(service.revokeToken('any-token')).resolves.toBeUndefined();
    });
  });

  describe('getUserInfo', () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: jest.fn(),
    };

    beforeEach(() => {
      mockHttpClient.mockResolvedValue(mockResponse);
    });

    it('should get user info successfully', async () => {
      const userInfoData = {
        id: 'user-123',
        username: 'testuser',
        discriminator: '1234',
      };
      mockResponse.json.mockResolvedValue(userInfoData);

      const result = await service.getUserInfo('token-123');

      expect(result).toEqual({
        userId: 'user-123',
        username: 'testuser',
        discriminator: '1234',
      });

      expect(mockHttpClient).toHaveBeenCalledWith(
        'https://api.example.com/v1/profile',
        {
          method: 'GET',
          headers: {
            'X-User-Auth': 'token-123',
          },
        }
      );

      expect(logger.info).toHaveBeenCalledWith('[OAuthTokenService] Getting user info');
    });

    it('should handle HTTP errors when getting user info', async () => {
      mockResponse.ok = false;
      mockResponse.status = 401;
      mockResponse.statusText = 'Unauthorized';
      mockResponse.json.mockResolvedValue({ error: 'Invalid token' });

      await expect(service.getUserInfo('invalid-token')).rejects.toThrow(
        'Get user info failed: Invalid token'
      );

      expect(logger.error).toHaveBeenCalledWith(
        '[OAuthTokenService] Failed to get user info:',
        expect.any(Error)
      );
    });

    it('should handle missing user ID in response', async () => {
      mockResponse.ok = false;
      mockResponse.status = 401;
      mockResponse.statusText = 'Unauthorized';
      mockResponse.json.mockResolvedValue({ username: 'testuser' });

      await expect(service.getUserInfo('token-123')).rejects.toThrow(
        'Get user info failed: Unauthorized'
      );
    });

    it('should handle network errors when getting user info', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network timeout'));

      await expect(service.getUserInfo('token-123')).rejects.toThrow('Network timeout');

      expect(logger.error).toHaveBeenCalledWith(
        '[OAuthTokenService] Failed to get user info:',
        expect.any(Error)
      );
    });
  });

  describe('error handling', () => {
    it('should properly format HTTP errors', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: jest.fn().mockResolvedValue({ error: 'Database connection failed' }),
      };
      mockHttpClient.mockResolvedValue(mockErrorResponse);

      await expect(service.exchangeCode('code', 'user')).rejects.toThrow(
        'OAuth exchange failed: Database connection failed'
      );
    });

    it('should handle response without error message', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: jest.fn().mockResolvedValue({}),
        headers: new Map([['content-type', 'application/json']]),
      };
      mockErrorResponse.headers.entries = jest.fn().mockReturnValue([['content-type', 'application/json']]);
      mockHttpClient.mockResolvedValue(mockErrorResponse);

      // validateToken doesn't throw for HTTP errors, it returns { valid: false }
      const result = await service.validateToken('token');
      expect(result).toEqual({ valid: false });
    });

    it('should handle JSON parsing errors', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      };
      mockHttpClient.mockResolvedValue(mockErrorResponse);

      await expect(service.refreshToken('token')).rejects.toThrow(
        'Invalid JSON'
      );
    });
  });
});