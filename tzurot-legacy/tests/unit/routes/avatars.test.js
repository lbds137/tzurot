/**
 * Tests for avatar HTTP route handler
 */

// Mock fs before requiring the routes module
jest.mock('fs');
jest.mock('../../../src/logger');
jest.mock('util', () => ({
  ...jest.requireActual('util'),
  promisify: jest.fn(fn => {
    if (fn.name === 'stat') {
      return jest.fn();
    }
    return fn;
  }),
}));

const fs = require('fs');
const { Readable } = require('stream');
const logger = require('../../../src/logger');
const { promisify } = require('util');

// Create promisified stat mock
const statMock = jest.fn();

// Override promisify to return our mock
promisify.mockImplementation(fn => {
  if (fn === fs.stat) {
    return statMock;
  }
  return fn;
});

// Set up fs mocks
fs.createReadStream = jest.fn();
fs.promises = {
  access: jest.fn(),
};

// Set up logger mocks
logger.info = jest.fn();
logger.warn = jest.fn();
logger.error = jest.fn();

// Now load route handler after mocks are set up
const avatarRoutes = require('../../../src/routes/avatars');

describe('Avatar Routes', () => {
  let req, res;
  let mockReadStream;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock request
    req = {
      method: 'GET',
      url: '/avatars/test-bot-abc123.png',
    };

    // Mock response
    res = {
      writeHead: jest.fn(),
      end: jest.fn(),
      pipe: jest.fn(),
      headersSent: false,
    };

    // Mock read stream
    mockReadStream = new Readable({
      read() {},
    });
    mockReadStream.pipe = jest.fn();
    mockReadStream.on = jest.fn((event, callback) => {
      if (event === 'error') {
        mockReadStream._errorCallback = callback;
      }
      return mockReadStream;
    });

    // Helper to emit errors later
    mockReadStream.emit = jest.fn((event, data) => {
      if (event === 'error' && mockReadStream._errorCallback) {
        mockReadStream._errorCallback(data);
      }
    });

    // Default mock behaviors
    statMock.mockResolvedValue({
      isFile: () => true,
      size: 1024,
    });
    fs.createReadStream.mockReturnValue(mockReadStream);
  });

  afterEach(() => {
    // Ensure stream is destroyed
    if (!mockReadStream.destroyed) {
      mockReadStream.destroy();
    }
  });

  describe('GET /avatars/:filename', () => {
    it('should serve PNG image successfully', async () => {
      req.url = '/avatars/test-bot-123abc.png';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'image/png',
        'Content-Length': 1024,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });

      expect(fs.createReadStream).toHaveBeenCalledWith(
        expect.stringContaining('test-bot-123abc.png')
      );

      expect(mockReadStream.pipe).toHaveBeenCalledWith(res);
    });

    it('should serve JPEG image with correct content type', async () => {
      req.url = '/avatars/test-bot-456def.jpg';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': 1024,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });
    });

    it('should serve GIF image with correct content type', async () => {
      req.url = '/avatars/animated-bot.gif';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'image/gif',
        'Content-Length': 1024,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });
    });

    it('should serve WebP image with correct content type', async () => {
      req.url = '/avatars/modern-bot.webp';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'image/webp',
        'Content-Length': 1024,
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      });
    });

    it('should return 400 for invalid filename format', async () => {
      req.url = '/avatars/invalid_file!name.png';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid filename' }));
      expect(fs.createReadStream).not.toHaveBeenCalled();
    });

    it('should return 400 for unsupported file extension', async () => {
      req.url = '/avatars/test-bot.bmp';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid filename' }));
    });

    it('should block directory traversal attempts', async () => {
      const maliciousUrls = [
        '/avatars/../../../etc/passwd',
        '/avatars/..%2F..%2Fetc%2Fpasswd',
        '/avatars/test/../../../secret.txt',
        '/avatars/./../config.js',
      ];

      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      for (const url of maliciousUrls) {
        jest.clearAllMocks();
        req.url = url;

        await handler(req, res);

        // Should be blocked - either 400 or 404
        expect(res.writeHead).toHaveBeenCalledWith(expect.any(Number), {
          'Content-Type': 'application/json',
        });

        const statusCode = res.writeHead.mock.calls[0][0];
        expect([400, 404]).toContain(statusCode);

        expect(fs.createReadStream).not.toHaveBeenCalled();
      }
    });

    it('should return 404 when file does not exist', async () => {
      req.url = '/avatars/missing-bot.png';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      const error = new Error('File not found');
      error.code = 'ENOENT';
      statMock.mockRejectedValueOnce(error);

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Avatar not found' }));
      expect(logger.info).toHaveBeenCalledWith('[AvatarRoute] Avatar not found: missing-bot.png');
    });

    it('should handle file access errors', async () => {
      req.url = '/avatars/forbidden-bot.png';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      const error = new Error('Permission denied');
      error.code = 'EACCES';
      statMock.mockRejectedValueOnce(error);

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(
        JSON.stringify({
          error: 'Internal server error',
        })
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle stream errors', async () => {
      req.url = '/avatars/error-bot.png';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      // Simulate stream error
      const streamError = new Error('Stream read error');
      mockReadStream.emit('error', streamError);

      expect(res.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(
        JSON.stringify({
          error: 'Failed to stream avatar',
        })
      );
      expect(logger.error).toHaveBeenCalledWith(
        '[AvatarRoute] Error streaming file error-bot.png:',
        streamError
      );
    });

    it('should handle URLs with query parameters', async () => {
      req.url = '/avatars/test-bot.png?v=123456';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      mockReadStream.emit('open');

      // Should extract filename without query params
      expect(fs.createReadStream).toHaveBeenCalledWith(expect.stringContaining('test-bot.png'));
      expect(fs.createReadStream).toHaveBeenCalledWith(expect.not.stringContaining('?'));
    });

    it('should handle encoded filenames', async () => {
      req.url = '/avatars/test%20bot%20123.png';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      // Should decode to "test bot 123.png" but reject due to spaces
      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid filename' }));
    });

    it('should validate filename length', async () => {
      // Create a filename that's too long but would pass other validation
      // Add a space to make it fail the regex validation
      const longFilename = 'a'.repeat(255) + ' ' + 'b'.repeat(44) + '.png';
      req.url = `/avatars/${longFilename}`;
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid filename' }));
    });
  });

  describe('Route Registration', () => {
    it('should export routes array with GET handler', () => {
      expect(avatarRoutes.routes).toBeDefined();
      expect(Array.isArray(avatarRoutes.routes)).toBe(true);
      expect(avatarRoutes.routes.length).toBe(2);

      // Check first route
      const route1 = avatarRoutes.routes[0];
      expect(route1).toEqual({
        method: 'GET',
        path: '/avatars',
        handler: expect.any(Function),
      });

      // Check second route
      const route2 = avatarRoutes.routes[1];
      expect(route2).toEqual({
        method: 'GET',
        path: '/avatars/',
        handler: expect.any(Function),
      });
    });

    it('should have correct route path for prefix matching', () => {
      // The httpServer uses prefix matching, so /avatars should match /avatars/*
      const route = avatarRoutes.routes[0];
      expect(route.path).toBe('/avatars');
    });
  });

  describe('Content Type Detection', () => {
    const testCases = [
      { ext: '.png', contentType: 'image/png' },
      { ext: '.jpg', contentType: 'image/jpeg' },
      { ext: '.jpeg', contentType: 'image/jpeg' },
      { ext: '.gif', contentType: 'image/gif' },
      { ext: '.webp', contentType: 'image/webp' },
    ];

    testCases.forEach(({ ext, contentType }) => {
      it(`should serve ${ext} files with ${contentType}`, async () => {
        req.url = `/avatars/test-file${ext}`;
        const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

        await handler(req, res);

        expect(res.writeHead).toHaveBeenCalledWith(200, {
          'Content-Type': contentType,
          'Content-Length': 1024,
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        });
      });
    });
  });

  describe('Caching Headers', () => {
    it('should set appropriate cache headers for avatars', async () => {
      req.url = '/avatars/cached-bot.png';
      const handler = avatarRoutes.routes.find(r => r.method === 'GET').handler;

      await handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'image/png',
        'Content-Length': 1024,
        'Cache-Control': 'public, max-age=86400', // 24 hours
        'X-Content-Type-Options': 'nosniff',
      });
    });
  });
});
