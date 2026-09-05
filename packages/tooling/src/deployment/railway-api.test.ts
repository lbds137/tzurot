import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { UsageError } from '../utils/errors.js';
import { railwayGraphql, deleteRailwayVariable } from './railway-api.js';

const SENTINEL_TOKEN = 'tok-SENTINEL-do-not-leak';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('railway-api', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    delete process.env.TZUROT_RAILWAY_API_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.TZUROT_RAILWAY_API_TOKEN;
  });

  describe('railwayGraphql', () => {
    it('rejects with UsageError and makes no request when the token is missing', async () => {
      delete process.env.TZUROT_RAILWAY_API_TOKEN;

      await expect(railwayGraphql('query {}', {})).rejects.toBeInstanceOf(UsageError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects with UsageError and makes no request when the token is an empty string', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = '';

      await expect(railwayGraphql('query {}', {})).rejects.toBeInstanceOf(UsageError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('never leaks the token in an error message on a non-2xx response', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(500, {}));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let caught: unknown;
      try {
        await railwayGraphql('query {}', {});
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : '';
      expect(message).not.toContain(SENTINEL_TOKEN);
      expect(String(caught)).not.toContain(SENTINEL_TOKEN);
      for (const spy of [logSpy, errSpy, warnSpy]) {
        for (const call of spy.mock.calls) {
          for (const arg of call) {
            expect(String(arg)).not.toContain(SENTINEL_TOKEN);
          }
        }
      }
    });

    it('never leaks the token in an error message when the API returns errors', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { errors: [{ message: 'Not authorized' }] }));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let caught: unknown;
      try {
        await railwayGraphql('query {}', {});
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : '';
      expect(message).toContain('Not authorized');
      expect(message).not.toContain(SENTINEL_TOKEN);
      expect(String(caught)).not.toContain(SENTINEL_TOKEN);
      for (const spy of [logSpy, errSpy, warnSpy]) {
        for (const call of spy.mock.calls) {
          for (const arg of call) {
            expect(String(arg)).not.toContain(SENTINEL_TOKEN);
          }
        }
      }
    });

    it('sends the expected request shape', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { ok: true } }));

      await railwayGraphql('query { foo }', { bar: 'baz' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://backboard.railway.app/graphql/v2');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers.Authorization).toBe(`Bearer ${SENTINEL_TOKEN}`);
      const parsedBody = JSON.parse(init.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(parsedBody.query).toBe('query { foo }');
      expect(parsedBody.variables).toEqual({ bar: 'baz' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('rejects with a timed-out message (never the token) when fetch aborts on timeout', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      const timeoutError = new DOMException('The operation was aborted', 'TimeoutError');
      mockFetch.mockRejectedValue(timeoutError);

      let caught: unknown;
      try {
        await railwayGraphql('query {}', {});
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : '';
      expect(message).toContain('timed out');
      expect(message).not.toContain(SENTINEL_TOKEN);
    });

    it('rejects when the response body is not valid JSON, naming only the status', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      } as unknown as Response);

      await expect(railwayGraphql('query {}', {})).rejects.toThrow(
        'Railway API returned a non-JSON body (status 200)'
      );
    });

    it('rejects on a non-JSON body from a non-2xx response, naming only the status', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      } as unknown as Response);

      await expect(railwayGraphql('query {}', {})).rejects.toThrow(
        'Railway API returned a non-JSON body (status 500)'
      );
    });

    it('surfaces the GraphQL error body on a non-2xx response instead of just the status', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(401, { errors: [{ message: 'Not Authorized' }] }));

      let caught: unknown;
      try {
        await railwayGraphql('query {}', {});
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : '';
      expect(message).toContain('Not Authorized');
      expect(message).toContain('401');
      expect(message).not.toContain(SENTINEL_TOKEN);
    });

    it('rejects when the response carries no data', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, {}));

      await expect(railwayGraphql('query {}', {})).rejects.toThrow('no data');
    });

    it('rejects cleanly when data and errors are explicit nulls', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: null, errors: null }));
      await expect(railwayGraphql('query {}', {})).rejects.toThrow('no data');
    });
    it('resolves with the parsed data on a happy path', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { hello: 'world' } }));

      await expect(railwayGraphql('query {}', {})).resolves.toEqual({ hello: 'world' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteRailwayVariable', () => {
    it('sends the query text and all four fields for a service-scoped delete', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: true } }));

      await deleteRailwayVariable({
        projectId: 'proj-1',
        environmentId: 'env-1',
        serviceId: 'svc-1',
        name: 'SOME_KEY',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as {
        query: string;
        variables: { input: Record<string, unknown> };
      };
      expect(parsedBody.query).toContain('variableDelete');
      expect(parsedBody.variables.input).toEqual({
        projectId: 'proj-1',
        environmentId: 'env-1',
        serviceId: 'svc-1',
        name: 'SOME_KEY',
      });
    });

    it('omits the serviceId key entirely for a shared (project-level) delete', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: true } }));

      await deleteRailwayVariable({
        projectId: 'proj-1',
        environmentId: 'env-1',
        name: 'SOME_KEY',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as {
        variables: { input: Record<string, unknown> };
      };
      expect(Object.hasOwn(parsedBody.variables.input, 'serviceId')).toBe(false);
    });

    it('rejects when the GraphQL API returns errors', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { errors: [{ message: 'Not authorized' }] }));

      await expect(
        deleteRailwayVariable({ projectId: 'p', environmentId: 'e', name: 'K' })
      ).rejects.toThrow('Not authorized');
    });

    it('rejects when Railway reports the delete as rejected', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: false } }));

      await expect(
        deleteRailwayVariable({ projectId: 'p', environmentId: 'e', name: 'SOME_KEY' })
      ).rejects.toThrow('SOME_KEY');
    });

    it('resolves on a happy path', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: true } }));

      await expect(
        deleteRailwayVariable({ projectId: 'p', environmentId: 'e', name: 'K' })
      ).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
