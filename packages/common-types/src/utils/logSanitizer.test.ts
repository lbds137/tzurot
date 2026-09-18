import { describe, it, expect, vi } from 'vitest';
import { sanitizeLogMessage, sanitizeObject, redactSensitiveQueryValues } from './logSanitizer.js';

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
      // Split to avoid triggering secretlint on the literal connection string
      const dbUrl = ['postgresql', '://user:secretpassword@localhost:5432/db'].join('');
      const message = `Connecting to ${dbUrl}`;
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

    it('should NOT redact numeric token COUNT fields (metrics, not secrets)', () => {
      // Auth tokens are string secrets; token COUNTS are numbers. Blanking the
      // counts was over-redaction that blinded context-budget/perf debugging.
      const obj = {
        tokensUsed: 4096,
        contextWindowTokens: 32768,
        historyTokensUsed: 1200,
        maxTokens: 2000,
        // A string 'token' value is still a possible secret → stays redacted.
        accessToken: 'secret-abc',
      };
      const result = sanitizeObject(obj) as Record<string, unknown>;
      expect(result.tokensUsed).toBe(4096);
      expect(result.contextWindowTokens).toBe(32768);
      expect(result.historyTokensUsed).toBe(1200);
      expect(result.maxTokens).toBe(2000);
      expect(result.accessToken).toBe('[REDACTED]');
    });

    it('should NOT redact apiKeySource metadata field — it carries no key value', () => {
      // Regression test for an over-redaction bug discovered 2026-04-29:
      // the broad `lowerKey.includes('apikey')` check matched `apiKeySource`
      // even though that field is a `'user'`/`'system'` discriminator with
      // no sensitive content. Tightened via `API_KEY_METADATA_FIELDS` allowlist.
      const obj = {
        apiKey: 'sk-1234567890abcdefghijklmnop',
        apiKeySource: 'user' as const,
      };
      const result = sanitizeObject(obj) as Record<string, unknown>;
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.apiKeySource).toBe('user');
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

    it('should preserve Error instances (return same reference)', () => {
      const error = new Error('Something went wrong');
      const result = sanitizeObject(error);
      expect(result).toBe(error);
    });

    it('should preserve Error instances nested in objects', () => {
      const error = new Error('Connection refused');
      const obj = { err: error, attempt: 1 };
      const result = sanitizeObject(obj) as { err: Error; attempt: number };
      expect(result.err).toBe(error);
      expect(result.attempt).toBe(1);
    });
  });

  describe('sanitizeObject - sensitive header names', () => {
    const SENTINEL = 'a'.repeat(64);

    it('should redact x-service-auth in a pino-http-shaped req object while leaving ids and host alone', () => {
      const obj = {
        req: {
          headers: {
            'x-service-auth': SENTINEL,
            'x-user-id': '278863839632818186',
            host: 'api.example.test',
          },
        },
      };
      const result = sanitizeObject(obj) as {
        req: { headers: { 'x-service-auth': string; 'x-user-id': string; host: string } };
      };
      expect(result.req.headers['x-service-auth']).toBe('[REDACTED]');
      expect(result.req.headers['x-user-id']).toBe('278863839632818186');
      expect(result.req.headers.host).toBe('api.example.test');
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
    });

    it('should redact a cookie header', () => {
      const obj = { headers: { cookie: 'session=abc123' } };
      const result = sanitizeObject(obj) as { headers: { cookie: string } };
      expect(result.headers.cookie).toBe('[REDACTED]');
    });

    it('should redact a set-cookie header', () => {
      const obj = { headers: { 'set-cookie': 'session=abc123; Path=/' } };
      const result = sanitizeObject(obj) as { headers: { 'set-cookie': string } };
      expect(result.headers['set-cookie']).toBe('[REDACTED]');
    });

    it('should redact an x-user-username header (PII)', () => {
      const obj = { headers: { 'x-user-username': 'someuser' } };
      const result = sanitizeObject(obj) as { headers: { 'x-user-username': string } };
      expect(result.headers['x-user-username']).toBe('[REDACTED]');
    });

    it('should leave a non-string cookie value as-is', () => {
      const obj = { headers: { cookie: 3 } };
      const result = sanitizeObject(obj) as { headers: { cookie: number } };
      expect(result.headers.cookie).toBe(3);
    });

    it('should redact a set-cookie header whose value is an array of strings', () => {
      const obj = { headers: { 'set-cookie': ['a=1', 'b=2'] } };
      const result = sanitizeObject(obj) as { headers: { 'set-cookie': string } };
      expect(result.headers['set-cookie']).toBe('[REDACTED]');
    });

    it('should redact an x-service-auth header whose value is an array of strings', () => {
      const obj = { headers: { 'x-service-auth': ['a', 'b'] } };
      const result = sanitizeObject(obj) as { headers: { 'x-service-auth': string } };
      expect(result.headers['x-service-auth']).toBe('[REDACTED]');
    });

    it('should leave a non-string, non-string-array x-service-auth value as-is (recursed, not blanked)', () => {
      const obj = { headers: { 'x-service-auth': { nested: 'x' } } };
      const result = sanitizeObject(obj) as { headers: { 'x-service-auth': { nested: string } } };
      expect(result.headers['x-service-auth']).toEqual({ nested: 'x' });
    });

    it('should redact client-IP fields and headers while leaving remotePort alone', () => {
      const obj = {
        req: {
          remoteAddress: '203.0.113.7',
          remotePort: 51234,
          headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
        },
      };
      const result = sanitizeObject(obj) as {
        req: { remoteAddress: string; remotePort: number; headers: { 'x-forwarded-for': string } };
      };
      expect(result.req.remoteAddress).toBe('[REDACTED]');
      expect(result.req.headers['x-forwarded-for']).toBe('[REDACTED]');
      expect(result.req.remotePort).toBe(51234);
    });

    it('should NOT redact near-miss field/header names', () => {
      // `x-service-authorized` does not contain the substring `authorization`
      // (…authoriz-ED vs. …authoriz-ATION), so it must not trip the existing
      // `lowerKey.includes('authorization')` arm either.
      const obj = { authStep: 'verify', 'x-service-authorized': 'yes' };
      const result = sanitizeObject(obj) as { authStep: string; 'x-service-authorized': string };
      expect(result.authStep).toBe('verify');
      expect(result['x-service-authorized']).toBe('yes');
    });

    // Mirrors SENSITIVE_HEADER_NAMES in logSanitizer.ts (unexported). A name removed from the
    // set reds its case below; a name ADDED to the set needs a case added here by hand — the
    // count pin only guards this list against losing an entry.
    const SENSITIVE_HEADER_NAME_CASES = [
      'x-service-auth',
      'cookie',
      'set-cookie',
      'x-api-key',
      'proxy-authorization',
      'x-user-username',
      'x-user-displayname',
      'x-forwarded-for',
      'x-real-ip',
      'cf-connecting-ip',
      'true-client-ip',
    ];

    it('should keep all 11 header cases (a dropped case reds; a new set member does not)', () => {
      expect(SENSITIVE_HEADER_NAME_CASES).toHaveLength(11);
    });

    it.each(SENSITIVE_HEADER_NAME_CASES)('should redact the %s header', name => {
      const obj = { headers: { [name]: `value-for-${name}` } };
      const result = sanitizeObject(obj) as { headers: Record<string, unknown> };
      expect(result.headers[name]).toBe('[REDACTED]');
    });

    // Mirrors SENSITIVE_FIELD_NAMES in logSanitizer.ts (unexported); same one-way guard as above.
    const SENSITIVE_FIELD_NAME_CASES = ['remoteAddress'];

    it('should keep the 1 field case (a dropped case reds; a new set member does not)', () => {
      expect(SENSITIVE_FIELD_NAME_CASES).toHaveLength(1);
    });

    it.each(SENSITIVE_FIELD_NAME_CASES)('should redact the %s field', key => {
      const obj = { req: { [key]: `value-for-${key}` } };
      const result = sanitizeObject(obj) as { req: Record<string, unknown> };
      expect(result.req[key]).toBe('[REDACTED]');
    });
  });

  describe('redactSensitiveQueryValues', () => {
    it('should redact a token query value while preserving the path and a non-sensitive param', () => {
      const url = '/api/foo?token=canary-alpha-0001&limit=10';
      const result = redactSensitiveQueryValues(url);
      expect(result).toBe('/api/foo?token=[REDACTED]&limit=10');
    });

    it('should redact apiKey, password, and clientSecret query values', () => {
      expect(redactSensitiveQueryValues('/x?apiKey=canary-bravo-0002')).toBe(
        '/x?apiKey=[REDACTED]'
      );
      expect(redactSensitiveQueryValues('/x?password=canary-charlie-0003')).toBe(
        '/x?password=[REDACTED]'
      );
      expect(redactSensitiveQueryValues('/x?clientSecret=canary-delta-0004')).toBe(
        '/x?clientSecret=[REDACTED]'
      );
    });

    it('should return a non-sensitive query byte-identical, including percent-encoding a re-serialize would normalize', () => {
      const url = '/api/foo?q=hello%20world&sort=asc';
      expect(redactSensitiveQueryValues(url)).toBe(url);
    });

    it('should return a url with no query unchanged', () => {
      const url = '/api/foo';
      expect(redactSensitiveQueryValues(url)).toBe(url);
    });

    it('should preserve a fragment after a redacted query', () => {
      const url = '/api/foo?token=canary-echo-0005#section';
      expect(redactSensitiveQueryValues(url)).toBe('/api/foo?token=[REDACTED]#section');
    });

    it('should redact every occurrence of a repeated sensitive key', () => {
      const url = '/api/foo?token=canary-foxtrot-0006&token=canary-golf-0007';
      expect(redactSensitiveQueryValues(url)).toBe('/api/foo?token=[REDACTED]&token=[REDACTED]');
    });

    it('should leave a bare valueless parameter alone while redacting a sensitive sibling', () => {
      const url = '/api/foo?flag&token=canary-hotel-0008';
      expect(redactSensitiveQueryValues(url)).toBe('/api/foo?flag&token=[REDACTED]');
    });

    it('should redact a token field with an empty string value (isSensitiveField treats "" as a redactable string)', () => {
      const url = '/api/foo?token=';
      expect(redactSensitiveQueryValues(url)).toBe('/api/foo?token=[REDACTED]');
    });

    it('should redact the entire query wholesale when the target fails WHATWG parsing, rather than fail open', () => {
      // A protocol-relative reference with an invalid bracketed host — verified
      // by probe to throw on `new URL(input, 'http://log-sanitizer.invalid')`.
      const url = '//[bad?token=canary-kilo-0011';
      const result = redactSensitiveQueryValues(url);
      expect(result).not.toContain('canary-kilo-0011');
      expect(result).toBe('//[bad?[REDACTED]');
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

      const args: unknown[] = [{ apiKey: 'sk-1234567890abcdefghijklmnop' }, 'Log message'];
      const method = vi.fn();

      sanitizeLogHook.call({}, args as Parameters<typeof Function.prototype.apply>, method);

      expect(method).toHaveBeenCalled();
      const calledArgs = method.mock.calls[0] as unknown[];
      expect((calledArgs[0] as { apiKey: string }).apiKey).toBe('[REDACTED]');
    });

    it('should sanitize string messages', async () => {
      const { sanitizeLogHook } = await import('./logSanitizer.js');

      const args: unknown[] = ['API key: sk-1234567890abcdefghijklmnop'];
      const method = vi.fn();

      sanitizeLogHook.call({}, args as Parameters<typeof Function.prototype.apply>, method);

      expect(method).toHaveBeenCalled();
      const calledArgs = method.mock.calls[0] as unknown[];
      expect(calledArgs[0]).toBe('API key: sk-[REDACTED]');
    });

    it('should sanitize additional string arguments', async () => {
      const { sanitizeLogHook } = await import('./logSanitizer.js');

      const args: unknown[] = [{ level: 'info' }, 'Message with key sk-1234567890abcdefghijklmnop'];
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
