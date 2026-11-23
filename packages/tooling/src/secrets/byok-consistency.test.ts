import { describe, it, expect } from 'vitest';
import {
  assertByokServicesConsistent,
  assertNoPendingNext,
  effectiveNext,
  nextSetRefusal,
  type ByokVarReader,
} from './byok-consistency.js';

const CUR = 'a'.repeat(64);
const OLD = 'b'.repeat(64);
const NXT = 'c'.repeat(64);
const NXT2 = 'd'.repeat(64);

type Vars = Record<string, Record<string, string>>;

function reader(vars: Vars): ByokVarReader {
  return (_env, service, key) => vars[service]?.[key] ?? '';
}

function both(per: Record<string, string>, perAw: Record<string, string> = per): Vars {
  return { 'api-gateway': per, 'ai-worker': perAw };
}

const HEX64 = /[0-9a-f]{64}/;

describe('effectiveNext', () => {
  it('treats a NEXT equal to CURRENT as unset', () => {
    expect(effectiveNext(CUR, CUR)).toBe('');
    expect(effectiveNext(CUR, NXT)).toBe(NXT);
    expect(effectiveNext(CUR, '')).toBe('');
  });
});

describe('assertByokServicesConsistent', () => {
  it('throws the byte-identical CURRENT message when CURRENT differs', () => {
    const vars = both({ API_KEY_ENCRYPTION_KEY: CUR }, { API_KEY_ENCRYPTION_KEY: OLD });

    expect(() => assertByokServicesConsistent('dev', reader(vars), { compareNext: true })).toThrow(
      'API_KEY_ENCRYPTION_KEY DIFFERS between api-gateway and ai-worker (dev) — a previous variable write partially failed. Re-set it on the lagging service (Railway dashboard history has the values), then re-run.'
    );
  });

  it('throws the PREVIOUS message (with the stage 3 hint) when PREVIOUS differs', () => {
    const vars = both(
      { API_KEY_ENCRYPTION_KEY: CUR, API_KEY_ENCRYPTION_KEY_PREVIOUS: OLD },
      { API_KEY_ENCRYPTION_KEY: CUR }
    );

    expect(() =>
      assertByokServicesConsistent('prod', reader(vars), { compareNext: false })
    ).toThrow(
      /API_KEY_ENCRYPTION_KEY_PREVIOUS DIFFERS between api-gateway and ai-worker \(prod\).*--resume\./s
    );
  });

  it('normalises PREVIOUS equal to CURRENT to unset', () => {
    const vars = both(
      { API_KEY_ENCRYPTION_KEY: CUR, API_KEY_ENCRYPTION_KEY_PREVIOUS: CUR },
      { API_KEY_ENCRYPTION_KEY: CUR }
    );

    expect(() =>
      assertByokServicesConsistent('dev', reader(vars), { compareNext: true })
    ).not.toThrow();
  });

  it('counts NEXT equal to CURRENT as unset, on both services or on one only', () => {
    const bothEqual = both({ API_KEY_ENCRYPTION_KEY: CUR, API_KEY_ENCRYPTION_KEY_NEXT: CUR });
    const oneEqual = both(
      { API_KEY_ENCRYPTION_KEY: CUR, API_KEY_ENCRYPTION_KEY_NEXT: CUR },
      { API_KEY_ENCRYPTION_KEY: CUR }
    );

    expect(() =>
      assertByokServicesConsistent('dev', reader(bothEqual), { compareNext: true })
    ).not.toThrow();
    expect(() =>
      assertByokServicesConsistent('dev', reader(oneEqual), { compareNext: true })
    ).not.toThrow();
  });

  it('throws on a NEXT mismatch with compareNext true and not with false', () => {
    const vars = both(
      { API_KEY_ENCRYPTION_KEY: CUR, API_KEY_ENCRYPTION_KEY_NEXT: NXT },
      { API_KEY_ENCRYPTION_KEY: CUR, API_KEY_ENCRYPTION_KEY_NEXT: NXT2 }
    );

    expect(() => assertByokServicesConsistent('dev', reader(vars), { compareNext: true })).toThrow(
      /API_KEY_ENCRYPTION_KEY_NEXT is set on api-gateway, ai-worker/
    );
    expect(() =>
      assertByokServicesConsistent('dev', reader(vars), { compareNext: false })
    ).not.toThrow();
  });

  it('with a window open, lists exactly the affected services var-delete commands', () => {
    const vars = both(
      {
        API_KEY_ENCRYPTION_KEY: CUR,
        API_KEY_ENCRYPTION_KEY_PREVIOUS: OLD,
        API_KEY_ENCRYPTION_KEY_NEXT: NXT,
      },
      { API_KEY_ENCRYPTION_KEY: CUR, API_KEY_ENCRYPTION_KEY_PREVIOUS: OLD }
    );

    let message = '';
    try {
      assertByokServicesConsistent('dev', reader(vars), { compareNext: true });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('while a rotation window is open');
    expect(message).toContain(
      '`pnpm ops deploy:var-delete --env dev --service api-gateway --name API_KEY_ENCRYPTION_KEY_NEXT --yes`'
    );
    expect(message).not.toContain('--service ai-worker');
    expect(message).not.toMatch(HEX64);
  });

  it('with no window open, says to re-run stage 1', () => {
    const vars = both(
      { API_KEY_ENCRYPTION_KEY: CUR, API_KEY_ENCRYPTION_KEY_NEXT: NXT },
      { API_KEY_ENCRYPTION_KEY: CUR }
    );

    expect(() => assertByokServicesConsistent('dev', reader(vars), { compareNext: true })).toThrow(
      /no rotation window open.*Re-run stage 1 \(`pnpm ops secrets:rotate-byok --env dev --stage 1`\)/s
    );
  });
});

describe('assertNoPendingNext', () => {
  it('passes when NEXT is absent or equal to CURRENT on every service', () => {
    const vars = both(
      { API_KEY_ENCRYPTION_KEY: CUR, API_KEY_ENCRYPTION_KEY_NEXT: CUR },
      { API_KEY_ENCRYPTION_KEY: CUR }
    );

    expect(() =>
      assertNoPendingNext({ env: 'dev', read: reader(vars), current: CUR, windowOpen: true })
    ).not.toThrow();
  });

  it('refuses a NEXT left on a single service', () => {
    const vars = both(
      { API_KEY_ENCRYPTION_KEY: CUR },
      {
        API_KEY_ENCRYPTION_KEY: CUR,
        API_KEY_ENCRYPTION_KEY_NEXT: NXT,
      }
    );

    expect(() =>
      assertNoPendingNext({ env: 'dev', read: reader(vars), current: CUR, windowOpen: false })
    ).toThrow(/NEXT is set on ai-worker \(dev\) with no rotation window open/);
  });
});

describe('nextSetRefusal', () => {
  it('names the services and carries no key value in either variant', () => {
    for (const windowOpen of [true, false]) {
      const error = nextSetRefusal({
        env: 'prod',
        windowOpen,
        servicesWithNext: ['api-gateway', 'ai-worker'],
      });

      expect(error.message).toContain('api-gateway, ai-worker');
      expect(error.message).not.toMatch(HEX64);
    }
  });
});
