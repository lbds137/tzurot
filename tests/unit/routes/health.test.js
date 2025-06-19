/**
 * Tests for Health Route
 */

// Mock dependencies
jest.mock('../../../src/logger');
jest.mock('os');

const healthRoute = require('../../../src/routes/health');
const logger = require('../../../src/logger');
const os = require('os');

describe('Health Route', () => {
  let mockRequest;
  let mockResponse;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Set up logger mocks
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();

    // Set up os mocks
    os.platform = jest.fn().mockReturnValue('linux');
    os.cpus = jest.fn().mockReturnValue([{}, {}, {}, {}]); // 4 CPUs
    os.totalmem = jest.fn().mockReturnValue(8 * 1024 * 1024 * 1024); // 8GB
    os.freemem = jest.fn().mockReturnValue(4 * 1024 * 1024 * 1024); // 4GB

    // Mock process methods
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100 * 1024 * 1024, // 100MB
      heapTotal: 50 * 1024 * 1024, // 50MB
      heapUsed: 30 * 1024 * 1024, // 30MB
      external: 10 * 1024 * 1024, // 10MB
    });

    // Create mock request and response objects
    mockRequest = {
      method: 'GET',
      url: '/health',
      headers: {},
      socket: {
        remoteAddress: '127.0.0.1',
      },
    };

    mockResponse = {
      writeHead: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
    };

    // Reset global context
    global.httpServerContext = {};
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.httpServerContext;
  });

  describe('route configuration', () => {
    it('should export routes array', () => {
      expect(healthRoute.routes).toBeDefined();
      expect(Array.isArray(healthRoute.routes)).toBe(true);
    });

    it('should define GET /health route', () => {
      const healthRouteConfig = healthRoute.routes.find(
        route => route.method === 'GET' && route.path === '/health'
      );

      expect(healthRouteConfig).toBeDefined();
      expect(typeof healthRouteConfig.handler).toBe('function');
    });

    it('should define GET /health/ route', () => {
      const healthRouteConfig = healthRoute.routes.find(
        route => route.method === 'GET' && route.path === '/health/'
      );

      expect(healthRouteConfig).toBeDefined();
      expect(typeof healthRouteConfig.handler).toBe('function');
    });
  });

  describe('health check handler', () => {
    let healthHandler;

    beforeEach(() => {
      healthHandler = healthRoute.routes.find(
        route => route.method === 'GET' && route.path === '/health'
      ).handler;
    });

    it('should return healthy status with 200 code', async () => {
      const mockDiscordClient = {
        ws: { status: 0, ping: 25 }, // 0 = READY
        guilds: { cache: { size: 5 } },
        users: { cache: { size: 100 } },
      };
      global.httpServerContext = { discordClient: mockDiscordClient };

      await healthHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      // Parse the JSON response to check the content
      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.status).toBe('healthy');
      expect(healthData.timestamp).toBeDefined();
      expect(healthData.uptime).toEqual({
        seconds: expect.any(Number),
        formatted: expect.any(String),
      });
      expect(healthData.memory).toBeDefined();
      expect(healthData.system).toBeDefined();
      expect(healthData.components.discord.connected).toBe(true);
      expect(healthData.components.ai.available).toBe(true);

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Health check request'));
    });

    it('should return critical status with 503 code when Discord disconnected', async () => {
      const mockDiscordClient = {
        ws: { status: 5 }, // 5 = DISCONNECTED
        guilds: { cache: { size: 0 } },
        users: { cache: { size: 0 } },
      };
      global.httpServerContext = { discordClient: mockDiscordClient };

      await healthHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(503, {
        'Content-Type': 'application/json',
      });

      // Parse the JSON response to check the content
      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.status).toBe('critical');
      expect(healthData.components.discord.connected).toBe(false);
      expect(healthData.components.discord.status).toBe('DISCONNECTED');
    });

    it('should handle missing Discord client gracefully', async () => {
      global.httpServerContext = {};

      await healthHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(503, {
        'Content-Type': 'application/json',
      });

      // Parse the JSON response to check the content
      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.status).toBe('critical');
      expect(healthData.components.discord.connected).toBe(false);
      expect(healthData.components.discord.status).toBe('No client provided');
    });

    it('should include detailed uptime in response', async () => {
      global.httpServerContext = {
        discordClient: {
          ws: { status: 0 },
          guilds: { cache: { size: 1 } },
          users: { cache: { size: 10 } },
        },
      };

      await healthHandler(mockRequest, mockResponse);

      // Parse the JSON response to check the content
      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.uptime).toEqual({
        seconds: expect.any(Number),
        formatted: expect.stringMatching(/\d+d \d+h \d+m \d+s/),
      });
      expect(healthData.uptime.seconds).toBeGreaterThanOrEqual(0);
    });

    it('should include detailed memory usage in response', async () => {
      global.httpServerContext = {
        discordClient: {
          ws: { status: 0 },
          guilds: { cache: { size: 1 } },
          users: { cache: { size: 10 } },
        },
      };

      await healthHandler(mockRequest, mockResponse);

      // Parse the JSON response to check the content
      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.memory).toEqual({
        rss: expect.stringMatching(/\d+ MB/),
        heapTotal: expect.stringMatching(/\d+ MB/),
        heapUsed: expect.stringMatching(/\d+ MB/),
        external: expect.stringMatching(/\d+ MB/),
      });
    });

    it('should include detailed system information in response', async () => {
      global.httpServerContext = {
        discordClient: {
          ws: { status: 0 },
          guilds: { cache: { size: 1 } },
          users: { cache: { size: 10 } },
        },
      };

      await healthHandler(mockRequest, mockResponse);

      // Parse the JSON response to check the content
      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.system).toEqual({
        platform: expect.any(String),
        nodeVersion: expect.any(String),
        cpuCount: expect.any(Number),
        totalMemory: expect.stringMatching(/\d+ MB/),
        freeMemory: expect.stringMatching(/\d+ MB/),
      });
    });

    it('should include detailed Discord connection information', async () => {
      const mockDiscordClient = {
        ws: { status: 0, ping: 42 },
        guilds: { cache: { size: 3 } },
        users: { cache: { size: 150 } },
      };
      global.httpServerContext = { discordClient: mockDiscordClient };

      await healthHandler(mockRequest, mockResponse);

      // Parse the JSON response to check the content
      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.components.discord).toEqual({
        connected: true,
        status: 'READY',
        ping: '42ms',
        guilds: 3,
        users: 150,
      });
    });

    it('should include AI service status information', async () => {
      global.httpServerContext = {
        discordClient: {
          ws: { status: 0 },
          guilds: { cache: { size: 1 } },
          users: { cache: { size: 10 } },
        },
      };

      await healthHandler(mockRequest, mockResponse);

      // Parse the JSON response to check the content
      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.components.ai).toEqual({
        available: true,
        status: 'operational',
        lastCheck: expect.any(String),
      });

      // Verify lastCheck is a valid ISO date string
      expect(new Date(healthData.components.ai.lastCheck)).toBeInstanceOf(Date);
    });

    it('should handle handler errors gracefully', async () => {
      // Mock Date.now to throw an error
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => {
        throw new Error('Date error');
      });

      await healthHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, {
        'Content-Type': 'application/json',
      });
      expect(mockResponse.end).toHaveBeenCalledWith(
        JSON.stringify({
          error: 'Internal Server Error',
          message: 'Date error',
        })
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[Health] Error generating health check data',
        expect.any(Error)
      );

      // Restore original Date.now
      Date.now = originalDateNow;
    });

    it('should include timestamp in response', async () => {
      global.httpServerContext = {
        discordClient: {
          ws: { status: 0 },
          guilds: { cache: { size: 1 } },
          users: { cache: { size: 10 } },
        },
      };

      await healthHandler(mockRequest, mockResponse);

      // Parse the JSON response to check the content
      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.timestamp).toBeDefined();
      expect(typeof healthData.timestamp).toBe('string');
      // Verify it's a valid ISO date string
      expect(new Date(healthData.timestamp)).toBeInstanceOf(Date);
    });
  });

  describe('route path variations', () => {
    it('should handle /health/ with trailing slash', async () => {
      const healthSlashHandler = healthRoute.routes.find(
        route => route.method === 'GET' && route.path === '/health/'
      ).handler;

      global.httpServerContext = {
        discordClient: {
          ws: { status: 0 },
          guilds: { cache: { size: 1 } },
          users: { cache: { size: 10 } },
        },
      };

      await healthSlashHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });

      const responseCall = mockResponse.end.mock.calls[0][0];
      const healthData = JSON.parse(responseCall);

      expect(healthData.status).toBe('healthy');
    });
  });

  describe('Discord status mapping', () => {
    let healthHandler;

    beforeEach(() => {
      healthHandler = healthRoute.routes.find(
        route => route.method === 'GET' && route.path === '/health'
      ).handler;
    });

    const statusMappings = [
      { wsStatus: 0, expected: 'READY', connected: true },
      { wsStatus: 1, expected: 'CONNECTING', connected: false },
      { wsStatus: 2, expected: 'RECONNECTING', connected: false },
      { wsStatus: 3, expected: 'IDLE', connected: false },
      { wsStatus: 4, expected: 'NEARLY', connected: false },
      { wsStatus: 5, expected: 'DISCONNECTED', connected: false },
    ];

    statusMappings.forEach(({ wsStatus, expected, connected }) => {
      it(`should map Discord status ${wsStatus} to ${expected}`, async () => {
        const mockDiscordClient = {
          ws: { status: wsStatus, ping: 25 },
          guilds: { cache: { size: 1 } },
          users: { cache: { size: 10 } },
        };
        global.httpServerContext = { discordClient: mockDiscordClient };

        await healthHandler(mockRequest, mockResponse);

        const responseCall = mockResponse.end.mock.calls[0][0];
        const healthData = JSON.parse(responseCall);

        expect(healthData.components.discord.status).toBe(expected);
        expect(healthData.components.discord.connected).toBe(connected);
      });
    });
  });
});
