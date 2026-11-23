import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRailwayGraphql } = vi.hoisted(() => ({ mockRailwayGraphql: vi.fn() }));

vi.mock('./railway-api.js', () => ({ railwayGraphql: mockRailwayGraphql }));

import {
  getRailwayDeploymentStatus,
  listRailwayLiveDeploymentIds,
} from './railway-deployment-status.js';

describe('getRailwayDeploymentStatus', () => {
  beforeEach(() => {
    mockRailwayGraphql.mockReset();
  });

  it('sends the deployment id as the query variable and returns the status', async () => {
    mockRailwayGraphql.mockResolvedValue({ deployment: { id: 'dep-1', status: 'REMOVED' } });

    const status = await getRailwayDeploymentStatus({ deploymentId: 'dep-1', env: 'dev' });

    expect(status).toBe('REMOVED');
    expect(mockRailwayGraphql).toHaveBeenCalledTimes(1);
    const [query, variables, env] = mockRailwayGraphql.mock.calls[0] as [string, unknown, string];
    expect(query).toContain('deployment(id: $id)');
    expect(variables).toEqual({ id: 'dep-1' });
    expect(env).toBe('dev');
  });

  it('throws on an unexpected response shape', async () => {
    mockRailwayGraphql.mockResolvedValue({ deployment: { id: 'dep-1' } });

    await expect(getRailwayDeploymentStatus({ deploymentId: 'dep-1', env: 'dev' })).rejects.toThrow(
      'Railway API returned an unexpected shape for deployment-status'
    );
  });

  it('throws when the deployment is null', async () => {
    mockRailwayGraphql.mockResolvedValue({ deployment: null });

    await expect(getRailwayDeploymentStatus({ deploymentId: 'dep-1', env: 'dev' })).rejects.toThrow(
      /unexpected shape/
    );
  });

  it('throws when the returned id is not the requested one', async () => {
    mockRailwayGraphql.mockResolvedValue({ deployment: { id: 'dep-2', status: 'REMOVED' } });

    await expect(getRailwayDeploymentStatus({ deploymentId: 'dep-1', env: 'dev' })).rejects.toThrow(
      /different deployment/
    );
  });

  it('propagates a transport error', async () => {
    mockRailwayGraphql.mockRejectedValue(new Error('boom'));

    await expect(getRailwayDeploymentStatus({ deploymentId: 'dep-1', env: 'dev' })).rejects.toThrow(
      'boom'
    );
  });
});

describe('listRailwayLiveDeploymentIds', () => {
  const LIVE_ARGS = { serviceId: 'svc-1', environmentId: 'env-1', env: 'dev' as const };

  function page(nodes: { id: string; status: string }[], hasNextPage: boolean = false) {
    return {
      deployments: {
        pageInfo: { hasNextPage },
        edges: nodes.map(node => ({ node })),
      },
    };
  }

  beforeEach(() => {
    mockRailwayGraphql.mockReset();
  });

  it('sends the service, environment and notIn status filter as the query input', async () => {
    mockRailwayGraphql.mockResolvedValue(page([{ id: 'dep-live', status: 'SUCCESS' }]));

    await listRailwayLiveDeploymentIds(LIVE_ARGS);

    expect(mockRailwayGraphql).toHaveBeenCalledTimes(1);
    const [query, variables, env] = mockRailwayGraphql.mock.calls[0] as [string, unknown, string];
    expect(query).toContain('deployments(input: $input');
    expect(variables).toEqual({
      input: {
        serviceId: 'svc-1',
        environmentId: 'env-1',
        status: { notIn: ['REMOVED', 'SKIPPED', 'FAILED'] },
      },
    });
    expect(env).toBe('dev');
  });

  it('returns the ids of the listed deployments in order', async () => {
    mockRailwayGraphql.mockResolvedValue(
      page([
        { id: 'dep-new', status: 'SUCCESS' },
        { id: 'dep-old', status: 'DRAINING' },
      ])
    );

    await expect(listRailwayLiveDeploymentIds(LIVE_ARGS)).resolves.toEqual(['dep-new', 'dep-old']);
  });

  it('drops a not-live node the server returned anyway, keeping only the live id', async () => {
    mockRailwayGraphql.mockResolvedValue(
      page([
        { id: 'dep-removed', status: 'REMOVED' },
        { id: 'dep-live', status: 'SUCCESS' },
      ])
    );

    await expect(listRailwayLiveDeploymentIds(LIVE_ARGS)).resolves.toEqual(['dep-live']);
  });

  it('returns an empty list when no deployment is live', async () => {
    mockRailwayGraphql.mockResolvedValue(page([]));

    await expect(listRailwayLiveDeploymentIds(LIVE_ARGS)).resolves.toEqual([]);
  });

  it('throws when the list spills past one page', async () => {
    mockRailwayGraphql.mockResolvedValue(page([{ id: 'dep-live', status: 'SUCCESS' }], true));

    await expect(listRailwayLiveDeploymentIds(LIVE_ARGS)).rejects.toThrow(/more live deployments/);
  });

  it('throws when hasNextPage is absent, so a truncated list cannot pass as complete', async () => {
    mockRailwayGraphql.mockResolvedValue({
      deployments: { pageInfo: {}, edges: [{ node: { id: 'dep-live', status: 'SUCCESS' } }] },
    });

    await expect(listRailwayLiveDeploymentIds(LIVE_ARGS)).rejects.toThrow(
      'Railway API returned an unexpected shape for live-deployments'
    );
  });

  it('throws on an unexpected response shape', async () => {
    mockRailwayGraphql.mockResolvedValue({ deployments: { edges: [] } });

    await expect(listRailwayLiveDeploymentIds(LIVE_ARGS)).rejects.toThrow(
      'Railway API returned an unexpected shape for live-deployments'
    );
  });

  it('propagates a transport error', async () => {
    mockRailwayGraphql.mockRejectedValue(new Error('boom'));

    await expect(listRailwayLiveDeploymentIds(LIVE_ARGS)).rejects.toThrow('boom');
  });
});
