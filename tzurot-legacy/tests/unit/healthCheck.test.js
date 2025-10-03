const http = require('http');

// Mock dependencies
jest.mock('../../src/logger');

describe('healthCheck', () => {
  let originalDateNow;
  let mockClient;
  let server;
  let healthCheck;
  let os;
  let logger;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock Date.now() for consistent time-based tests BEFORE requiring the module
    originalDateNow = Date.now;
    Date.now = jest.fn();
    Date.now.mockReturnValue(1000000); // Initial start time

    // Clear the module cache and re-require after mocking Date.now
    jest.resetModules();

    // Re-mock logger after resetModules
    jest.doMock('../../src/logger', () => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }));

    // Mock os module before requiring healthCheck
    jest.doMock('os', () => ({
      cpus: jest.fn().mockReturnValue([{}, {}, {}, {}]), // 4 cores
      totalmem: jest.fn().mockReturnValue(8 * 1024 * 1024 * 1024), // 8GB
      freemem: jest.fn().mockReturnValue(4 * 1024 * 1024 * 1024), // 4GB
      loadavg: jest.fn().mockReturnValue([1.5, 2.0, 1.75]),
    }));

    os = require('os');
    logger = require('../../src/logger');
    healthCheck = require('../../src/healthCheck');

    // Mock Discord client
    mockClient = {
      isReady: jest.fn().mockReturnValue(true),
      ws: { ping: 42 },
      guilds: { cache: { size: 5 } },
      uptime: 3661000, // 1 hour, 1 minute, 1 second
    };

    // Mock process properties
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process, 'arch', {
      value: 'x64',
      writable: true,
      configurable: true,
    });
    Object.defineProperty(process, 'version', {
      value: 'v16.0.0',
      writable: true,
      configurable: true,
    });
    jest.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100 * 1024 * 1024, // 100MB
      heapTotal: 80 * 1024 * 1024, // 80MB
      heapUsed: 60 * 1024 * 1024, // 60MB
      external: 10 * 1024 * 1024, // 10MB
    });
  });

  afterEach(() => {
    Date.now = originalDateNow;
    if (server) {
      server.close();
      server = null;
    }
    jest.resetModules();
    jest.restoreAllMocks();
  });

  describe('getUptime', () => {
    it('should calculate uptime correctly', () => {
      Date.now.mockReturnValue(1010000); // 10 seconds later
      const uptime = healthCheck.getUptime();
      expect(uptime).toBe(10);
    });

    it('should return 0 immediately after start', () => {
      Date.now.mockReturnValue(1000000); // Same as start time
      const uptime = healthCheck.getUptime();
      expect(uptime).toBe(0);
    });

    it('should handle large uptimes', () => {
      Date.now.mockReturnValue(1000000 + 86400000 * 7); // 7 days later
      const uptime = healthCheck.getUptime();
      expect(uptime).toBe(604800); // 7 days in seconds
    });
  });

  describe('formatUptime', () => {
    it('should format uptime with all units', () => {
      const formatted = healthCheck.formatUptime(90061); // 1 day, 1 hour, 1 minute, 1 second
      expect(formatted).toBe('1d 1h 1m 1s');
    });

    it('should format zero uptime', () => {
      const formatted = healthCheck.formatUptime(0);
      expect(formatted).toBe('0d 0h 0m 0s');
    });

    it('should format uptime with only seconds', () => {
      const formatted = healthCheck.formatUptime(45);
      expect(formatted).toBe('0d 0h 0m 45s');
    });

    it('should format uptime with multiple days', () => {
      const formatted = healthCheck.formatUptime(259200); // 3 days
      expect(formatted).toBe('3d 0h 0m 0s');
    });

    it('should handle edge cases correctly', () => {
      expect(healthCheck.formatUptime(3599)).toBe('0d 0h 59m 59s');
      expect(healthCheck.formatUptime(3600)).toBe('0d 1h 0m 0s');
      expect(healthCheck.formatUptime(86399)).toBe('0d 23h 59m 59s');
      expect(healthCheck.formatUptime(86400)).toBe('1d 0h 0m 0s');
    });
  });

  describe('getMemoryUsage', () => {
    it('should return formatted memory usage', () => {
      const memory = healthCheck.getMemoryUsage();
      expect(memory).toEqual({
        rss: '100 MB',
        heapTotal: '80 MB',
        heapUsed: '60 MB',
        external: '10 MB',
        memoryUsagePercent: '75%',
      });
    });

    it('should handle small memory values', () => {
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 512 * 1024, // 0.5MB
        heapTotal: 1024 * 1024, // 1MB
        heapUsed: 256 * 1024, // 0.25MB
        external: 0,
      });

      const memory = healthCheck.getMemoryUsage();
      expect(memory).toEqual({
        rss: '1 MB', // Rounds up
        heapTotal: '1 MB',
        heapUsed: '0 MB', // Rounds down
        external: '0 MB',
        memoryUsagePercent: '25%',
      });
    });

    it('should calculate memory usage percentage correctly', () => {
      jest.spyOn(process, 'memoryUsage').mockReturnValue({
        rss: 0,
        heapTotal: 100 * 1024 * 1024,
        heapUsed: 33 * 1024 * 1024,
        external: 0,
      });

      const memory = healthCheck.getMemoryUsage();
      expect(memory.memoryUsagePercent).toBe('33%');
    });
  });

  describe('getSystemInfo', () => {
    it('should return system information', () => {
      const sysInfo = healthCheck.getSystemInfo();
      expect(sysInfo).toEqual({
        platform: 'linux',
        arch: 'x64',
        nodeVersion: 'v16.0.0',
        cpuCores: 4,
        totalMemory: '8192 MB',
        freeMemory: '4096 MB',
        loadAverage: [1.5, 2.0, 1.75],
      });
    });

    it('should handle different CPU counts', () => {
      os.cpus.mockReturnValue([{}, {}, {}, {}, {}, {}, {}, {}]); // 8 cores
      const sysInfo = healthCheck.getSystemInfo();
      expect(sysInfo.cpuCores).toBe(8);
    });

    it('should handle different memory values', () => {
      os.totalmem.mockReturnValue(16 * 1024 * 1024 * 1024); // 16GB
      os.freemem.mockReturnValue(1 * 1024 * 1024 * 1024); // 1GB

      const sysInfo = healthCheck.getSystemInfo();
      expect(sysInfo.totalMemory).toBe('16384 MB');
      expect(sysInfo.freeMemory).toBe('1024 MB');
    });
  });

  describe('createHealthServer', () => {
    let mockRequest;
    let mockResponse;
    let mockServer;

    beforeEach(() => {
      mockRequest = {
        url: '/health',
        socket: { remoteAddress: '127.0.0.1' },
      };

      mockResponse = {
        writeHead: jest.fn(),
        end: jest.fn(),
      };

      // Create a mock server
      mockServer = {
        listen: jest.fn((port, callback) => {
          if (callback) callback();
        }),
        on: jest.fn(),
        close: jest.fn(callback => {
          if (callback) callback();
        }),
      };

      // Mock http.createServer
      jest.spyOn(http, 'createServer').mockImplementation(handler => {
        // Store the handler for testing
        mockServer._handler = handler;
        return mockServer;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should create HTTP server on specified port', () => {
      server = healthCheck.createHealthServer(mockClient, 3001);

      expect(http.createServer).toHaveBeenCalled();
      expect(mockServer.listen).toHaveBeenCalledWith(3001, expect.any(Function));
      expect(logger.info).toHaveBeenCalledWith('Health check server running on port 3001');
    });

    it('should respond to /health endpoint with 200', () => {
      server = healthCheck.createHealthServer(mockClient, 3002);
      const handler = mockServer._handler;

      // Simulate request
      Date.now.mockReturnValue(1010000); // 10 seconds later
      handler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });
      expect(mockResponse.end).toHaveBeenCalled();

      // Check the response data
      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.status).toBe('ok');
      expect(responseData.uptime.seconds).toBe(10);
      expect(responseData.components.discord.status).toBe('ok');
    });

    it('should respond to /health/ endpoint (with trailing slash)', () => {
      server = healthCheck.createHealthServer(mockClient, 3003);
      const handler = mockServer._handler;

      mockRequest.url = '/health/';
      handler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });
    });

    it('should return 404 for non-health endpoints', () => {
      server = healthCheck.createHealthServer(mockClient, 3004);
      const handler = mockServer._handler;

      mockRequest.url = '/other';
      handler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(404, {
        'Content-Type': 'application/json',
      });
      expect(mockResponse.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Not Found' }));
    });

    it('should return 200 for degraded status', () => {
      mockClient.isReady.mockReturnValue(false);
      server = healthCheck.createHealthServer(mockClient, 3005);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'application/json',
      });
      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.status).toBe('degraded');
    });

    it('should handle errors in health check generation', () => {
      jest.spyOn(process, 'memoryUsage').mockImplementation(() => {
        throw new Error('Memory error');
      });

      server = healthCheck.createHealthServer(mockClient, 3006);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, {
        'Content-Type': 'application/json',
      });
      expect(mockResponse.end).toHaveBeenCalledWith(
        JSON.stringify({
          error: 'Internal Server Error',
          message: 'Memory error',
        })
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Error generating health check data',
        expect.any(Error)
      );
    });

    it('should log health check requests', () => {
      server = healthCheck.createHealthServer(mockClient, 3007);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Health check request from 127.0.0.1')
      );
    });

    it('should handle server errors', () => {
      server = healthCheck.createHealthServer(mockClient, 3008);
      const error = new Error('Server error');

      mockServer.on.mock.calls.find(call => call[0] === 'error')[1](error);

      expect(logger.error).toHaveBeenCalledWith('Health check server error: Server error', error);
    });

    it('should use default port when not specified', () => {
      server = healthCheck.createHealthServer(mockClient);

      expect(mockServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    });

    it('should check Discord status correctly when connected', () => {
      server = healthCheck.createHealthServer(mockClient, 3010);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.components.discord).toEqual({
        status: 'ok',
        message: 'Connected to Discord',
        ping: '42ms',
        servers: 5,
        uptime: '0d 1h 1m 1s',
      });
    });

    it('should check Discord status correctly when not ready', () => {
      mockClient.isReady.mockReturnValue(false);
      server = healthCheck.createHealthServer(mockClient, 3011);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.components.discord.status).toBe('error');
      expect(responseData.components.discord.message).toBe('Not connected to Discord');
    });

    it('should handle missing Discord client', () => {
      server = healthCheck.createHealthServer(null, 3012);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.components.discord).toEqual({
        status: 'unavailable',
        message: 'Discord client not initialized',
      });
    });

    it('should handle missing ping value', () => {
      mockClient.ws.ping = undefined;
      server = healthCheck.createHealthServer(mockClient, 3013);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.components.discord.ping).toBe('Unknown');
    });

    it('should handle missing uptime value', () => {
      mockClient.uptime = undefined;
      server = healthCheck.createHealthServer(mockClient, 3014);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.components.discord.uptime).toBe('Unknown');
    });

    it('should check AI status', () => {
      server = healthCheck.createHealthServer(mockClient, 3015);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.components.ai).toEqual({
        status: 'ok',
        message: 'AI service assumed operational (no direct health check implemented)',
      });
    });

    it('should return overall ok status when all components are healthy', () => {
      Date.now.mockReturnValue(1010000); // 10 seconds later
      server = healthCheck.createHealthServer(mockClient, 3016);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.status).toBe('ok');
      expect(responseData.timestamp).toBeDefined();
      expect(responseData.uptime.seconds).toBe(10);
      expect(responseData.uptime.formatted).toBe('0d 0h 0m 10s');
      expect(responseData.memory).toBeDefined();
      expect(responseData.system).toBeDefined();
    });

    it('should return degraded status when one component is unhealthy', () => {
      mockClient.isReady.mockReturnValue(false);
      server = healthCheck.createHealthServer(mockClient, 3017);
      const handler = mockServer._handler;

      handler(mockRequest, mockResponse);

      const responseData = JSON.parse(mockResponse.end.mock.calls[0][0]);
      expect(responseData.status).toBe('degraded');
    });
  });
});
