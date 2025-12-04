import { describe, it, expect, vi } from 'vitest';
import { sanitizeLogMessage, sanitizeObject } from './logSanitizer.js';

describe('logSanitizer', () => {
  describe('sanitizeLogMessage', () => {
    it('should redact OpenAI API keys', () => {
      const message = 'API key: sk-1234567890abcdefghijklmnop';
      expect(sanitizeLogMessage(message)).toBe('API key: sk-[REDACTED]');
    });

    it('should redact OpenAI project keys', () => {
      const message = 'Key: sk-proj-1234567890abcdefghijklmnop';
      expect(sanitizeLogMessage(message)).toBe('Key: sk-[REDACTED]');
    });

    it('should redact OpenRouter API keys', () => {
      const message = 'OpenRouter key: sk-or-v1-1234567890abcdefghij';
      expect(sanitizeLogMessage(message)).toBe('OpenRouter key: sk-or-[REDACTED]');
    });

    it('should redact Anthropic API keys', () => {
      const message = 'Anthropic: sk-ant-api03-1234567890abcdefghij';
      expect(sanitizeLogMessage(message)).toBe('Anthropic: sk-ant-[REDACTED]');
    });

    it('should redact Google API keys', () => {
      const message = 'Google key: AIzaSyA1234567890abcdefghijklmnopqrstuvwx';
      expect(sanitizeLogMessage(message)).toBe('Google key: AIza[REDACTED]');
    });

    it('should redact Bearer tokens', () => {
      const message = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
      expect(sanitizeLogMessage(message)).toBe('Authorization: Bearer [REDACTED]');
    });

    it('should redact database URLs with passwords', () => {
      const message = 'Connecting to postgresql://user:secretpassword@localhost:5432/db';
      expect(sanitizeLogMessage(message)).toBe(
        'Connecting to postgresql://[REDACTED]@localhost:5432/db'
      );
    });

    it('should redact Redis URLs with passwords', () => {
      const message = 'Redis: redis://default:mypassword@redis.railway.internal:6379';
      expect(sanitizeLogMessage(message)).toBe(
        'Redis: redis://[REDACTED]@redis.railway.internal:6379'
      );
    });

    it('should redact JSON API key values', () => {
      const message = '{"api_key": "sk-1234567890abcdefghijklmnop", "model": "gpt-4"}';
      expect(sanitizeLogMessage(message)).toBe('{"api_key": "[REDACTED]", "model": "gpt-4"}');
    });

    it('should redact multiple keys in one message', () => {
      const message =
        'OpenAI: sk-abcdefghijklmnopqrstuvwxyz, Google: AIzaSyA1234567890abcdefghijklmnopqrstuvwx';
      const result = sanitizeLogMessage(message);
      expect(result).toContain('sk-[REDACTED]');
      expect(result).toContain('AIza[REDACTED]');
      expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
    });

    it('should not modify messages without sensitive data', () => {
      const message = 'Processing request for user 123';
      expect(sanitizeLogMessage(message)).toBe(message);
    });

    it('should handle empty strings', () => {
      expect(sanitizeLogMessage('')).toBe('');
    });

    it('should handle non-string input gracefully', () => {
      // @ts-expect-error Testing runtime behavior with invalid input
      expect(sanitizeLogMessage(123)).toBe(123);
      // @ts-expect-error Testing runtime behavior with invalid input
      expect(sanitizeLogMessage(null)).toBe(null);
    });
  });

  describe('sanitizeObject', () => {
    it('should sanitize string values in objects', () => {
      const obj = {
        message: 'Using key sk-1234567890abcdefghijklmnop',
        count: 5,
      };
      const result = sanitizeObject(obj) as Record<string, unknown>;
      expect(result.message).toBe('Using key sk-[REDACTED]');
      expect(result.count).toBe(5);
    });

    it('should redact keys named apiKey/api_key/secret/token/password', () => {
      const obj = {
        apiKey: 'sk-1234567890abcdefghijklmnop',
        api_key: 'some-key',
        secret: 'my-secret',
        token: 'jwt-token',
        password: 'hunter2',
        normalField: 'visible',
      };
      const result = sanitizeObject(obj) as Record<string, unknown>;
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.api_key).toBe('[REDACTED]');
      expect(result.secret).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.password).toBe('[REDACTED]');
      expect(result.normalField).toBe('visible');
    });

    it('should handle nested objects', () => {
      const obj = {
        request: {
          headers: {
            authorization: 'Bearer token123',
          },
          body: {
            apiKey: 'secret-key',
          },
        },
      };
      const result = sanitizeObject(obj) as {
        request: { headers: { authorization: string }; body: { apiKey: string } };
      };
      expect(result.request.headers.authorization).toBe('[REDACTED]');
      expect(result.request.body.apiKey).toBe('[REDACTED]');
    });

    it('should handle arrays', () => {
      const arr = [
        'sk-1234567890abcdefghijklmnop',
        { key: 'AIzaSyA1234567890abcdefghijklmnopqrstuvwx' },
      ];
      const result = sanitizeObject(arr) as [string, { key: string }];
      expect(result[0]).toBe('sk-[REDACTED]');
      expect(result[1].key).toBe('AIza[REDACTED]');
    });

    it('should handle null and undefined', () => {
      expect(sanitizeObject(null)).toBe(null);
      expect(sanitizeObject(undefined)).toBe(undefined);
    });

    it('should handle primitives', () => {
      expect(sanitizeObject(123)).toBe(123);
      expect(sanitizeObject(true)).toBe(true);
    });

    it('should prevent infinite recursion with deep nesting', () => {
      // Create an object with more than 10 levels of nesting
      let obj: { nested?: unknown } = { nested: 'value' };
      for (let i = 0; i < 15; i++) {
        obj = { nested: obj };
      }
      // Should not throw and should handle gracefully
      const result = sanitizeObject(obj);
      expect(result).toBeDefined();
    });

    it('should handle error objects', () => {
      const error = new Error('API call failed with key sk-1234567890abcdefghijklmnop');
      const result = sanitizeObject({
        err: {
          message: error.message,
          stack: error.stack,
        },
      }) as { err: { message: string } };
      expect(result.err.message).toContain('sk-[REDACTED]');
    });
  });

  describe('createSanitizedSerializers', () => {
    it('should return object with req and res serializers', async () => {
      const { createSanitizedSerializers } = await import('./logSanitizer.js');
      const serializers = createSanitizedSerializers();

      expect(serializers).toHaveProperty('req');
      expect(serializers).toHaveProperty('res');
      expect(typeof serializers.req).toBe('function');
      expect(typeof serializers.res).toBe('function');
    });

    it('should sanitize request objects', async () => {
      const { createSanitizedSerializers } = await import('./logSanitizer.js');
      const serializers = createSanitizedSerializers();

      const req = {
        headers: {
          authorization: 'Bearer secret-token',
        },
        url: '/api/test',
      };

      const result = serializers.req(req) as { headers: { authorization: string }; url: string };
      expect(result.headers.authorization).toBe('[REDACTED]');
      expect(result.url).toBe('/api/test');
    });

    it('should sanitize response objects', async () => {
      const { createSanitizedSerializers } = await import('./logSanitizer.js');
      const serializers = createSanitizedSerializers();

      const res = {
        body: {
          apiKey: 'sk-1234567890abcdefghijklmnop',
        },
        statusCode: 200,
      };

      const result = serializers.res(res) as { body: { apiKey: string }; statusCode: number };
      expect(result.body.apiKey).toBe('[REDACTED]');
      expect(result.statusCode).toBe(200);
    });
  });

  describe('sanitizeLogHook', () => {
    it('should sanitize object bindings', async () => {
      const { sanitizeLogHook } = await import('./logSanitizer.js');

      const args: unknown[] = [
        { apiKey: 'sk-1234567890abcdefghijklmnop' },
        'Log message',
      ];
      const method = vi.fn();

      sanitizeLogHook.call({}, args as Parameters<typeof Function.prototype.apply>, method);

      expect(method).toHaveBeenCalled();
      const calledArgs = method.mock.calls[0] as unknown[];
      expect((calledArgs[0] as { apiKey: string }).apiKey).toBe('[REDACTED]');
    });

    it('should sanitize string messages', async () => {
      const { sanitizeLogHook } = await import('./logSanitizer.js');

      const args: unknown[] = [
        'API key: sk-1234567890abcdefghijklmnop',
      ];
      const method = vi.fn();

      sanitizeLogHook.call({}, args as Parameters<typeof Function.prototype.apply>, method);

      expect(method).toHaveBeenCalled();
      const calledArgs = method.mock.calls[0] as unknown[];
      expect(calledArgs[0]).toBe('API key: sk-[REDACTED]');
    });

    it('should sanitize additional string arguments', async () => {
      const { sanitizeLogHook } = await import('./logSanitizer.js');

      const args: unknown[] = [
        { level: 'info' },
        'Message with key sk-1234567890abcdefghijklmnop',
      ];
      const method = vi.fn();

      sanitizeLogHook.call({}, args as Parameters<typeof Function.prototype.apply>, method);

      expect(method).toHaveBeenCalled();
      const calledArgs = method.mock.calls[0] as unknown[];
      expect(calledArgs[1]).toBe('Message with key sk-[REDACTED]');
    });

    it('should handle empty args', async () => {
      const { sanitizeLogHook } = await import('./logSanitizer.js');

      const args: unknown[] = [];
      const method = vi.fn();

      sanitizeLogHook.call({}, args as Parameters<typeof Function.prototype.apply>, method);

      expect(method).toHaveBeenCalled();
    });
  });
});
