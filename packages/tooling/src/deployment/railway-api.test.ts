import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import util from 'node:util';

import { UsageError } from '../utils/errors.js';
import {
  railwayGraphql,
  deleteRailwayVariable,
  requireRailwayApiToken,
  listRailwayVariableNames,
  upsertRailwayVariable,
  redeployRailwayService,
} from './railway-api.js';

const SENTINEL_TOKEN = 'tok-SENTINEL-do-not-leak';
const SENTINEL_TOKEN_DEV = 'tok-SENTINEL-dev-do-not-leak';
const SENTINEL_TOKEN_PROD = 'tok-SENTINEL-prod-do-not-leak';

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
    delete process.env.TZUROT_RAILWAY_API_TOKEN_DEV;
    delete process.env.TZUROT_RAILWAY_API_TOKEN_PROD;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.TZUROT_RAILWAY_API_TOKEN_DEV;
    delete process.env.TZUROT_RAILWAY_API_TOKEN_PROD;
  });

  describe('requireRailwayApiToken', () => {
    it('reads the DEV-suffixed variable for env "dev" and not the PROD one', () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN_DEV;
      process.env.TZUROT_RAILWAY_API_TOKEN_PROD = SENTINEL_TOKEN_PROD;

      expect(requireRailwayApiToken('dev')).toBe(SENTINEL_TOKEN_DEV);
    });

    it('reads the PROD-suffixed variable for env "prod" and not the DEV one', () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN_DEV;
      process.env.TZUROT_RAILWAY_API_TOKEN_PROD = SENTINEL_TOKEN_PROD;

      expect(requireRailwayApiToken('prod')).toBe(SENTINEL_TOKEN_PROD);
    });

    it('names the specific missing suffixed variable for the requested env', () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN_DEV;

      expect(() => requireRailwayApiToken('prod')).toThrow('TZUROT_RAILWAY_API_TOKEN_PROD');
    });
  });

  describe('railwayGraphql', () => {
    it('rejects with UsageError and makes no request when the token is missing', async () => {
      delete process.env.TZUROT_RAILWAY_API_TOKEN_DEV;

      await expect(railwayGraphql('query {}', {}, 'dev')).rejects.toBeInstanceOf(UsageError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects with UsageError and makes no request when the token is an empty string', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = '';

      await expect(railwayGraphql('query {}', {}, 'dev')).rejects.toBeInstanceOf(UsageError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('never leaks the token in an error message on a non-2xx response', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(500, {}));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let caught: unknown;
      try {
        await railwayGraphql('query {}', {}, 'dev');
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
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { errors: [{ message: 'Not authorized' }] }));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let caught: unknown;
      try {
        await railwayGraphql('query {}', {}, 'dev');
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
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { ok: true } }));

      await railwayGraphql('query { foo }', { bar: 'baz' }, 'dev');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://backboard.railway.app/graphql/v2');
      expect(init.method).toBe('POST');
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Project-Access-Token']).toBe(SENTINEL_TOKEN);
      const parsedBody = JSON.parse(init.body as string) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(parsedBody.query).toBe('query { foo }');
      expect(parsedBody.variables).toEqual({ bar: 'baz' });
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('rejects with a timed-out message (never the token) when fetch aborts on timeout', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      const timeoutError = new DOMException('The operation was aborted', 'TimeoutError');
      mockFetch.mockRejectedValue(timeoutError);

      let caught: unknown;
      try {
        await railwayGraphql('query {}', {}, 'dev');
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : '';
      expect(message).toContain('timed out');
      expect(message).not.toContain(SENTINEL_TOKEN);
    });

    it('rejects when the response body is not valid JSON, naming only the status', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      } as unknown as Response);

      await expect(railwayGraphql('query {}', {}, 'dev')).rejects.toThrow(
        'Railway API returned a non-JSON body (status 200)'
      );
    });

    it('rejects on a non-JSON body from a non-2xx response, naming only the status', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      } as unknown as Response);

      await expect(railwayGraphql('query {}', {}, 'dev')).rejects.toThrow(
        'Railway API returned a non-JSON body (status 500)'
      );
    });

    it('surfaces the GraphQL error body on a non-2xx response instead of just the status', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(401, { errors: [{ message: 'Not Authorized' }] }));

      let caught: unknown;
      try {
        await railwayGraphql('query {}', {}, 'dev');
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
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, {}));

      await expect(railwayGraphql('query {}', {}, 'dev')).rejects.toThrow('no data');
    });

    it('rejects cleanly when data and errors are explicit nulls', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: null, errors: null }));
      await expect(railwayGraphql('query {}', {}, 'dev')).rejects.toThrow('no data');
    });
    it('resolves with the parsed data on a happy path', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { hello: 'world' } }));

      await expect(railwayGraphql('query {}', {}, 'dev')).resolves.toEqual({ hello: 'world' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteRailwayVariable', () => {
    it('sends the query text and all four fields for a service-scoped delete', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: true } }));

      await deleteRailwayVariable({
        projectId: 'proj-1',
        environmentId: 'env-1',
        serviceId: 'svc-1',
        name: 'SOME_KEY',
        env: 'dev',
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
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: true } }));

      await deleteRailwayVariable({
        projectId: 'proj-1',
        environmentId: 'env-1',
        name: 'SOME_KEY',
        env: 'dev',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as {
        variables: { input: Record<string, unknown> };
      };
      expect(Object.hasOwn(parsedBody.variables.input, 'serviceId')).toBe(false);
    });

    it('rejects when the GraphQL API returns errors', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { errors: [{ message: 'Not authorized' }] }));

      await expect(
        deleteRailwayVariable({ projectId: 'p', environmentId: 'e', name: 'K', env: 'dev' })
      ).rejects.toThrow('Not authorized');
    });

    it('rejects when Railway reports the delete as rejected', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: false } }));

      await expect(
        deleteRailwayVariable({ projectId: 'p', environmentId: 'e', name: 'SOME_KEY', env: 'dev' })
      ).rejects.toThrow('SOME_KEY');
    });

    it('rejects a non-boolean response as a shape change instead of silently succeeding', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: 'true' } }));

      await expect(
        deleteRailwayVariable({ projectId: 'p', environmentId: 'e', name: 'SOME_KEY', env: 'dev' })
      ).rejects.toThrow('unexpected shape');
    });

    it('rejects with a shape-changed error when the response is missing variableDelete entirely', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: {} }));

      await expect(
        deleteRailwayVariable({ projectId: 'p', environmentId: 'e', name: 'SOME_KEY', env: 'dev' })
      ).rejects.toThrow('unexpected shape');
    });

    it('uses the PROD-suffixed token when env is "prod"', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_PROD = SENTINEL_TOKEN_PROD;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: true } }));

      await deleteRailwayVariable({ projectId: 'p', environmentId: 'e', name: 'K', env: 'prod' });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['Project-Access-Token']).toBe(SENTINEL_TOKEN_PROD);
    });

    it('resolves on a happy path', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableDelete: true } }));

      await expect(
        deleteRailwayVariable({ projectId: 'p', environmentId: 'e', name: 'K', env: 'dev' })
      ).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('listRailwayVariableNames', () => {
    it('returns only the keys, never the fixture values', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(
        jsonResponse(200, {
          data: { variables: { FOO_KEY: 'secret-value-1', BAR_KEY: 'secret-value-2' } },
        })
      );

      const names = await listRailwayVariableNames({
        projectId: 'p',
        environmentId: 'e',
        env: 'dev',
      });

      expect(names.sort()).toEqual(['BAR_KEY', 'FOO_KEY']);
      expect(names).not.toContain('secret-value-1');
      expect(names).not.toContain('secret-value-2');
    });

    it('omits the serviceId key entirely when none is given', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variables: {} } }));

      await listRailwayVariableNames({ projectId: 'p', environmentId: 'e', env: 'dev' });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as {
        variables: Record<string, unknown>;
      };
      expect(Object.hasOwn(parsedBody.variables, 'serviceId')).toBe(false);
    });

    it('sends the serviceId key when one is given', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variables: {} } }));

      await listRailwayVariableNames({
        projectId: 'p',
        environmentId: 'e',
        serviceId: 'svc-1',
        env: 'dev',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as {
        variables: Record<string, unknown>;
      };
      expect(parsedBody.variables.serviceId).toBe('svc-1');
    });

    it('rejects a non-record variables response as a shape change', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variables: 'not-a-record' } }));

      await expect(
        listRailwayVariableNames({ projectId: 'p', environmentId: 'e', env: 'dev' })
      ).rejects.toThrow('unexpected shape');
    });
  });

  describe('upsertRailwayVariable', () => {
    const SENTINEL_VALUE = 'sentinel-secret-value-do-not-leak';

    it('omits the serviceId key entirely for a shared (project-level) upsert', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableUpsert: true } }));

      await upsertRailwayVariable({
        projectId: 'p',
        environmentId: 'e',
        name: 'SOME_KEY',
        value: SENTINEL_VALUE,
        skipDeploys: true,
        env: 'dev',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as {
        variables: { input: Record<string, unknown> };
      };
      expect(Object.hasOwn(parsedBody.variables.input, 'serviceId')).toBe(false);
    });

    it('sends the serviceId key when one is given (positive control)', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableUpsert: true } }));

      await upsertRailwayVariable({
        projectId: 'p',
        environmentId: 'e',
        serviceId: 'svc-1',
        name: 'SOME_KEY',
        value: SENTINEL_VALUE,
        skipDeploys: true,
        env: 'dev',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as {
        variables: { input: Record<string, unknown> };
      };
      expect(parsedBody.variables.input.serviceId).toBe('svc-1');
    });

    it('sends skipDeploys: true through to the request body', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableUpsert: true } }));

      await upsertRailwayVariable({
        projectId: 'p',
        environmentId: 'e',
        name: 'SOME_KEY',
        value: SENTINEL_VALUE,
        skipDeploys: true,
        env: 'dev',
      });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as {
        variables: { input: Record<string, unknown> };
      };
      expect(parsedBody.variables.input.skipDeploys).toBe(true);
    });

    it('rejects a non-boolean variableUpsert response as a shape error, not a rejection', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableUpsert: { id: 'x' } } }));

      let caught: unknown;
      try {
        await upsertRailwayVariable({
          projectId: 'p',
          environmentId: 'e',
          name: 'SOME_KEY',
          value: SENTINEL_VALUE,
          skipDeploys: true,
          env: 'dev',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : '';
      expect(message).toContain('unexpected shape');
      expect(message).not.toContain('rejected');
    });

    it('throws the rejection error naming the variable when variableUpsert is false', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableUpsert: false } }));

      await expect(
        upsertRailwayVariable({
          projectId: 'p',
          environmentId: 'e',
          name: 'SOME_KEY',
          value: SENTINEL_VALUE,
          skipDeploys: true,
          env: 'dev',
        })
      ).rejects.toThrow('SOME_KEY');
    });

    it('discards a Railway error message that echoes the secret value verbatim', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(
        jsonResponse(200, {
          errors: [{ message: `value must not contain X, got: ${SENTINEL_VALUE}` }],
        })
      );

      let caught: unknown;
      try {
        await upsertRailwayVariable({
          projectId: 'p',
          environmentId: 'e',
          name: 'SOME_KEY',
          value: SENTINEL_VALUE,
          skipDeploys: true,
          env: 'dev',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      // The leak surface is whatever Node's default uncaught-exception printer renders —
      // message, stack, AND cause chain — not just `.message`. `util.inspect` at depth null
      // renders all three, which is exactly what would hit stderr on an uncaught rethrow.
      const inspected = util.inspect(caught, { depth: null });
      expect(inspected).not.toContain(SENTINEL_VALUE);
      // Railway's own wording is discarded wholesale, not selectively scrubbed.
      expect(inspected).not.toContain('value must not contain X');
    });

    it('discards a PARTIAL echo of the secret value that no full-string match would catch', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      const fragment = SENTINEL_VALUE.slice(0, 16);
      mockFetch.mockResolvedValue(
        jsonResponse(200, {
          errors: [{ message: `value rejected, saw prefix: ${fragment}...` }],
        })
      );

      let caught: unknown;
      try {
        await upsertRailwayVariable({
          projectId: 'p',
          environmentId: 'e',
          name: 'SOME_KEY',
          value: SENTINEL_VALUE,
          skipDeploys: true,
          env: 'dev',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const inspected = util.inspect(caught, { depth: null });
      expect(inspected).not.toContain(fragment);
      expect(inspected).not.toContain(SENTINEL_VALUE);
    });

    it('discards Railway wording from an ordinary error that carries no secret at all', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(
        jsonResponse(200, {
          errors: [{ message: 'internal validation error: field "region" is unrecognized' }],
        })
      );

      let caught: unknown;
      try {
        await upsertRailwayVariable({
          projectId: 'p',
          environmentId: 'e',
          name: 'SOME_KEY',
          value: SENTINEL_VALUE,
          skipDeploys: true,
          env: 'dev',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const inspected = util.inspect(caught, { depth: null });
      expect(inspected).not.toContain('region');
      expect(inspected).not.toContain('unrecognized');
      expect(inspected).toContain('SOME_KEY');
    });

    it('still propagates UsageError intact when the token is missing', async () => {
      // No TZUROT_RAILWAY_API_TOKEN_DEV set — requireRailwayApiToken throws UsageError
      // before any network call.

      let caught: unknown;
      try {
        await upsertRailwayVariable({
          projectId: 'p',
          environmentId: 'e',
          name: 'SOME_KEY',
          value: SENTINEL_VALUE,
          skipDeploys: true,
          env: 'dev',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(UsageError);
      const message = caught instanceof Error ? caught.message : '';
      expect(message).toContain('TZUROT_RAILWAY_API_TOKEN_DEV');
    });

    it('never leaks the secret value in an error message or console output', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { variableUpsert: false } }));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let caught: unknown;
      try {
        await upsertRailwayVariable({
          projectId: 'p',
          environmentId: 'e',
          name: 'SOME_KEY',
          value: SENTINEL_VALUE,
          skipDeploys: true,
          env: 'dev',
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = caught instanceof Error ? caught.message : '';
      expect(message).not.toContain(SENTINEL_VALUE);
      expect(String(caught)).not.toContain(SENTINEL_VALUE);
      for (const spy of [logSpy, errSpy, warnSpy]) {
        for (const call of spy.mock.calls) {
          for (const arg of call) {
            expect(String(arg)).not.toContain(SENTINEL_VALUE);
          }
        }
      }
    });
  });

  describe('redeployRailwayService', () => {
    it('sends both ids in the request', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { serviceInstanceRedeploy: true } }));

      await redeployRailwayService({ environmentId: 'env-1', serviceId: 'svc-1', env: 'dev' });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string) as { variables: Record<string, unknown> };
      expect(parsedBody.variables).toEqual({ environmentId: 'env-1', serviceId: 'svc-1' });
    });

    it('throws on a false response', async () => {
      process.env.TZUROT_RAILWAY_API_TOKEN_DEV = SENTINEL_TOKEN;
      mockFetch.mockResolvedValue(jsonResponse(200, { data: { serviceInstanceRedeploy: false } }));

      await expect(
        redeployRailwayService({ environmentId: 'env-1', serviceId: 'svc-1', env: 'dev' })
      ).rejects.toThrow('svc-1');
    });
  });
});
