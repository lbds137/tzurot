import { describe, it, expect } from 'vitest';

import { RailwayRedeployRefusedError } from '../deployment/railway-api.js';
import { composeRedeployRepair, partitionRedeployFailures } from './redeploy-repair-text.js';

const SENTENCE_TAIL =
  ': the redeploy was refused because the latest deployment is not SUCCESS — wait for it to settle, or fix it in the Railway dashboard, then redeploy';

describe('the refused-service repair (built inside partitionRedeployFailures)', () => {
  const refused = (name: string): { name: string; error: unknown } => ({
    name,
    error: new RailwayRedeployRefusedError('BUILDING'),
  });
  const cmd = (svc: string): string =>
    `\`pnpm ops deploy:redeploy --env dev --service ${svc} --yes\``;

  it('names one service and appends the retry commands as " it with <commands>"', () => {
    expect(partitionRedeployFailures([refused('ai-worker')], 'dev').refusedRepair).toBe(
      `ai-worker${SENTENCE_TAIL} it with ${cmd('ai-worker')}, wait for it to reach SUCCESS`
    );
  });

  it('joins several names with ", " and says " them with <commands>"', () => {
    expect(
      partitionRedeployFailures([refused('api-gateway'), refused('ai-worker')], 'dev').refusedRepair
    ).toBe(
      `api-gateway, ai-worker${SENTENCE_TAIL} them with ${cmd('api-gateway')}; ${cmd('ai-worker')}, wait for each to reach SUCCESS`
    );
  });

  it('puts the wait-for-SUCCESS clause after the last command, in the singular and the plural form', () => {
    const one = partitionRedeployFailures([refused('ai-worker')], 'dev').refusedRepair ?? '';
    const several =
      partitionRedeployFailures([refused('api-gateway'), refused('ai-worker')], 'dev')
        .refusedRepair ?? '';

    expect(one.indexOf('wait for it to reach SUCCESS')).toBeGreaterThan(
      one.lastIndexOf('deploy:redeploy')
    );
    expect(several.indexOf('wait for each to reach SUCCESS')).toBeGreaterThan(
      several.lastIndexOf('deploy:redeploy')
    );
  });
});

describe('composeRedeployRepair', () => {
  it('returns the plain repair when nothing was refused', () => {
    expect(composeRedeployRepair(null, '`cmd`', 'plain')).toBe('plain');
  });

  it('returns only the refused repair when no command remains', () => {
    expect(composeRedeployRepair('refused', '', 'plain')).toBe('refused');
  });

  it('puts the refused repair first and the plain repair after "; for the rest: "', () => {
    expect(composeRedeployRepair('refused', '`cmd`', 'plain')).toBe('refused; for the rest: plain');
  });

  it('lowercases the plain repair only when it is joined after "for the rest:"', () => {
    expect(composeRedeployRepair('refused', '`cmd`', 'Repair it')).toBe(
      'refused; for the rest: repair it'
    );
    expect(composeRedeployRepair(null, '`cmd`', 'Repair it')).toBe('Repair it');
  });
});

describe('partitionRedeployFailures', () => {
  const cmd = (svc: string): string =>
    `\`pnpm ops deploy:redeploy --env dev --service ${svc} --yes\``;

  it('returns a null refused repair and every command when nothing was refused', () => {
    expect(
      partitionRedeployFailures(
        [
          { name: 'api-gateway', error: new Error('boom') },
          { name: 'ai-worker', error: new Error('boom') },
        ],
        'dev'
      )
    ).toEqual({
      refusedRepair: null,
      commands: `${cmd('api-gateway')}; ${cmd('ai-worker')}`,
      plainNames: ['api-gateway', 'ai-worker'],
    });
  });

  it('puts the refused services in the dashboard-first repair with their commands as the retry', () => {
    expect(
      partitionRedeployFailures(
        [
          { name: 'api-gateway', error: new RailwayRedeployRefusedError('BUILDING') },
          { name: 'ai-worker', error: new Error('boom') },
        ],
        'dev'
      )
    ).toEqual({
      refusedRepair: `api-gateway${SENTENCE_TAIL} it with ${cmd('api-gateway')}, wait for it to reach SUCCESS`,
      commands: cmd('ai-worker'),
      plainNames: ['ai-worker'],
    });
  });

  it('leaves commands and plainNames empty when every failure was refused', () => {
    const result = partitionRedeployFailures(
      [{ name: 'ai-worker', error: new RailwayRedeployRefusedError('BUILDING') }],
      'dev'
    );
    expect(result.commands).toBe('');
    expect(result.plainNames).toEqual([]);
  });
});
