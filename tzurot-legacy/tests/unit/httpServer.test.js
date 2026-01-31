/**
 * Tests for HTTP Server
 */

// Mock dependencies
jest.mock('../../src/logger');

const { createHTTPServer, registerRoute } = require('../../src/httpServer');
const logger = require('../../src/logger');

describe('HTTP Server', () => {
  let server;
  let mockRequest;
  let mockResponse;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Set up logger mocks
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();

    // Create mock request and response objects
    mockRequest = {
      method: 'GET',
      url: '/test',
      headers: {},
      on: jest.fn(),
      setTimeout: jest.fn(),
    };

    mockResponse = {
      writeHead: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
      statusCode: 200,
    };

    // Mock the request.on('data') and request.on('end') events
    mockRequest.on.mockImplementation((event, callback) => {
      if (event === 'data') {
        // Don't call callback for GET requests (no data)
      } else if (event === 'end') {
        setImmediate(callback); // Call end callback immediately
      }
    });
  });

  afterEach(() => {
    if (server && server.close) {
      server.close();
    }
    jest.useRealTimers();
  });

  describe('createHTTPServer', () => {
    it('should create server and register default routes', () => {
      server = createHTTPServer();

      expect(server).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('[HTTPServer] Registered route: GET:/health');
      expect(logger.info).toHaveBeenCalledWith('[HTTPServer] Registered route: GET:/health/');
      expect(logger.info).toHaveBeenCalledWith(
        '[HTTPServer] Registered route: POST:/webhook/github'
      );
    });

    it('should create server with custom port', () => {
      server = createHTTPServer(8080);

      expect(server).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('[HTTPServer] Registered route: GET:/health');
    });

    it('should create server with context', () => {
      const context = { version: '1.0.0' };
      server = createHTTPServer(3000, context);

      expect(server).toBeDefined();
      expect(global.httpServerContext).toEqual(context);
    });
  });

  describe('registerRoute', () => {
    beforeEach(() => {
      server = createHTTPServer(3000);
    });

    it('should register a GET route', () => {
      const handler = jest.fn();
      registerRoute('GET', '/test', handler);

      expect(logger.info).toHaveBeenCalledWith('[HTTPServer] Registered route: GET:/test');
    });

    it('should register a POST route', () => {
      const handler = jest.fn();
      registerRoute('POST', '/webhook', handler);

      expect(logger.info).toHaveBeenCalledWith('[HTTPServer] Registered route: POST:/webhook');
    });

    it('should handle case-insensitive methods', () => {
      const handler = jest.fn();
      registerRoute('get', '/test', handler);

      expect(logger.info).toHaveBeenCalledWith('[HTTPServer] Registered route: GET:/test');
    });
  });

  describe('request handling', () => {
    let handler;

    beforeEach(() => {
      server = createHTTPServer(3000);
      handler = jest.fn((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    });

    it('should handle registered routes', async () => {
      registerRoute('GET', '/test', handler);

      // Simulate the HTTP server's request handler
      const serverHandler = server._events.request || server.listeners('request')[0];

      mockRequest.method = 'GET';
      mockRequest.url = '/test';

      await serverHandler(mockRequest, mockResponse);

      expect(handler).toHaveBeenCalledWith(mockRequest, mockResponse);
    });

    it('should handle routes with query parameters via prefix matching', async () => {
      registerRoute('GET', '/test', handler);

      const serverHandler = server._events.request || server.listeners('request')[0];

      mockRequest.method = 'GET';
      mockRequest.url = '/test?param=value';

      await serverHandler(mockRequest, mockResponse);

      // Server now uses prefix matching, so /test?param=value matches /test
      expect(handler).toHaveBeenCalledWith(mockRequest, mockResponse);
    });

    it('should return 404 for unregistered routes', async () => {
      const serverHandler = server._events.request || server.listeners('request')[0];

      mockRequest.method = 'GET';
      mockRequest.url = '/nonexistent';

      await serverHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(404, {
        'Content-Type': 'application/json',
      });
      expect(mockResponse.end).toHaveBeenCalledWith(
        JSON.stringify({ error: 'Not Found', path: '/nonexistent' })
      );
    });

    it('should return 404 for unsupported methods (routes are method-specific)', async () => {
      registerRoute('GET', '/test', handler);

      const serverHandler = server._events.request || server.listeners('request')[0];

      mockRequest.method = 'DELETE';
      mockRequest.url = '/test';

      await serverHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(404, {
        'Content-Type': 'application/json',
      });
      expect(mockResponse.end).toHaveBeenCalledWith(
        JSON.stringify({ error: 'Not Found', path: '/test' })
      );
    });

    it('should handle POST requests with body parsing', async () => {
      const postHandler = jest.fn((req, res) => {
        res.writeHead(200);
        res.end('OK');
      });

      registerRoute('POST', '/webhook', postHandler);

      const serverHandler = server._events.request || server.listeners('request')[0];

      mockRequest.method = 'POST';
      mockRequest.url = '/webhook';
      mockRequest.headers['content-type'] = 'application/json';

      // Mock POST data
      const postData = JSON.stringify({ test: 'data' });
      mockRequest.on.mockImplementation((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(postData));
        } else if (event === 'end') {
          setImmediate(callback);
        }
      });

      await serverHandler(mockRequest, mockResponse);

      expect(postHandler).toHaveBeenCalledWith(mockRequest, mockResponse);
    });

    it('should handle errors gracefully', async () => {
      const errorHandler = jest.fn(() => {
        throw new Error('Handler error');
      });

      registerRoute('GET', '/error', errorHandler);

      const serverHandler = server._events.request || server.listeners('request')[0];

      mockRequest.method = 'GET';
      mockRequest.url = '/error';

      await serverHandler(mockRequest, mockResponse);

      expect(logger.error).toHaveBeenCalledWith(
        '[HTTPServer] Error handling GET:/error:',
        expect.any(Error)
      );
      expect(mockResponse.writeHead).toHaveBeenCalledWith(500, {
        'Content-Type': 'application/json',
      });
      expect(mockResponse.end).toHaveBeenCalledWith(
        JSON.stringify({ error: 'Internal Server Error', message: 'Handler error' })
      );
    });

    it('should set CORS headers on responses', async () => {
      registerRoute('GET', '/test', handler);

      const serverHandler = server._events.request || server.listeners('request')[0];

      await serverHandler(mockRequest, mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, X-Hub-Signature-256, X-GitHub-Event'
      );
    });

    it('should handle OPTIONS preflight requests', async () => {
      const serverHandler = server._events.request || server.listeners('request')[0];

      mockRequest.method = 'OPTIONS';
      mockRequest.url = '/test';

      await serverHandler(mockRequest, mockResponse);

      expect(mockResponse.writeHead).toHaveBeenCalledWith(200);
      expect(mockResponse.end).toHaveBeenCalledWith();
    });
  });

  describe('server lifecycle', () => {
    it('should create HTTP server instance', () => {
      server = createHTTPServer(4000);

      expect(server).toBeDefined();
      expect(typeof server.listen).toBe('function');
      expect(typeof server.on).toBe('function');
    });
  });
});
