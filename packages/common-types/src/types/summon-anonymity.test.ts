import { describe, it, expect } from 'vitest';
import { resolveSummonAnonymity, type SummonAnonymity } from './summon-anonymity.js';

const PERSONA = { activePersonaId: 'persona-1', activePersonaName: 'Vee' };

describe('resolveSummonAnonymity', () => {
  it('explicit incognito=true → incognito (regardless of framing)', () => {
    expect(resolveSummonAnonymity({ incognito: true, isWeighIn: true }, PERSONA)).toEqual({
      kind: 'incognito',
    });
    expect(resolveSummonAnonymity({ incognito: true, isWeighIn: false }, PERSONA)).toEqual({
      kind: 'incognito',
    });
  });

  it('explicit incognito=false → personal even when isWeighIn=true (a personal weigh-in)', () => {
    expect(resolveSummonAnonymity({ incognito: false, isWeighIn: true }, PERSONA)).toEqual({
      kind: 'personal',
      activePersonaId: 'persona-1',
      activePersonaName: 'Vee',
    });
  });

  it('incognito unset → defaults to the framing: isWeighIn=true is anonymous', () => {
    expect(resolveSummonAnonymity({ isWeighIn: true }, PERSONA)).toEqual({ kind: 'incognito' });
  });

  it('incognito unset + isWeighIn=false/unset → personal', () => {
    expect(resolveSummonAnonymity({ isWeighIn: false }, PERSONA).kind).toBe('personal');
    expect(resolveSummonAnonymity({}, PERSONA).kind).toBe('personal');
  });

  it('carries a null persona name through the personal arm', () => {
    const result = resolveSummonAnonymity(
      { incognito: false },
      { activePersonaId: 'p', activePersonaName: null }
    );
    expect(result).toEqual({ kind: 'personal', activePersonaId: 'p', activePersonaName: null });
  });

  it('fail-safes to incognito when a personal summon has no resolved persona id', () => {
    // The invalid state `{ kind: 'personal', activePersonaId: '' }` must never be
    // constructed — a personal arm with empty/null/undefined id collapses to
    // incognito (the safe, observable direction).
    for (const missing of ['', null, undefined] as const) {
      expect(
        resolveSummonAnonymity(
          { incognito: false },
          { activePersonaId: missing, activePersonaName: 'Vee' }
        )
      ).toEqual({ kind: 'incognito' });
    }
  });
});

describe('SummonAnonymity (compile-time invariants)', () => {
  it('makes "incognito with a persona" unrepresentable', () => {
    // @ts-expect-error — the incognito arm has no activePersonaId; bundling a
    // persona into an anonymous summon is exactly the drift this prevents.
    const invalid: SummonAnonymity = { kind: 'incognito', activePersonaId: 'x' };
    expect(invalid.kind).toBe('incognito');
  });

  it('cannot read activePersonaId without narrowing to the personal arm', () => {
    const mode = resolveSummonAnonymity({ incognito: false }, PERSONA);
    // @ts-expect-error — activePersonaId is only present on the personal arm;
    // reading it off the bare union is rejected until `kind === 'personal'`.
    const _id: string = mode.activePersonaId;
    if (mode.kind === 'personal') {
      // narrowed → access is allowed and the type is non-null `string`
      const id: string = mode.activePersonaId;
      expect(id).toBe('persona-1');
    }
  });
});
