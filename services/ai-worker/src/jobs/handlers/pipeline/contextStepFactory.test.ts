/**
 * The factory is three constructor calls, so what is worth testing is not that
 * it runs — it is that every collaborator production needs actually reaches the
 * step. That is the regression this module was extracted to make impossible:
 * a hand-rebuilt copy in the contract test silently omitted the data source,
 * which switched the roster-blurb fetch off in the one test whose purpose is
 * catching wiring gaps.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildContextStep } from './contextStepFactory.js';

const { assemblerCtor, dataSourceCtor, stepCtor } = vi.hoisted(() => ({
  assemblerCtor: vi.fn(),
  dataSourceCtor: vi.fn(),
  stepCtor: vi.fn(),
}));

vi.mock('../../../services/context/PrismaContextDataSource.js', () => ({
  PrismaContextDataSource: class {
    constructor(...args: unknown[]) {
      dataSourceCtor(...args);
    }
  },
}));

vi.mock('../../../services/context/ContextAssembler.js', () => ({
  ContextAssembler: class {
    constructor(...args: unknown[]) {
      assemblerCtor(...args);
    }
  },
}));

vi.mock('./steps/ContextStep.js', () => ({
  ContextStep: class {
    constructor(...args: unknown[]) {
      stepCtor(...args);
    }
  },
}));

vi.mock('@tzurot/identity', () => ({
  getOrCreateUserService: vi.fn(() => ({ tag: 'user-service' })),
  getOrCreatePersonaResolver: vi.fn(() => ({ tag: 'persona-resolver' })),
}));

describe('buildContextStep', () => {
  it('hands the step BOTH the assembler and the data source', () => {
    // The second argument is the whole point: without it,
    // ContextStep.fetchCharacterBlurbs short-circuits and no roster blurb is
    // ever read, silently and with every other test still green.
    buildContextStep({ tag: 'prisma' } as never);

    expect(stepCtor).toHaveBeenCalledTimes(1);
    const [assembler, dataSource] = stepCtor.mock.calls[0];
    expect(assembler).toBeDefined();
    expect(dataSource).toBeDefined();
  });

  it('constructs the data source from the prisma client it was handed', () => {
    // The file's own premise is that every collaborator production needs
    // actually reaches the step — and the prisma passthrough is one of those
    // facts, so leaving it unasserted was the same gap one level down.
    dataSourceCtor.mockClear();

    buildContextStep({ tag: 'prisma' } as never);

    expect(dataSourceCtor).toHaveBeenCalledWith({ tag: 'prisma' });
  });

  it('gives the assembler the same data-source instance the step gets', () => {
    // Two instances would mean two connection paths and, more importantly, that
    // one of them could be swapped without the other noticing.
    stepCtor.mockClear();
    assemblerCtor.mockClear();

    buildContextStep({ tag: 'prisma' } as never);

    const [, stepDataSource] = stepCtor.mock.calls[0];
    const [assemblerDeps] = assemblerCtor.mock.calls[0] as [{ dataSource: unknown }];
    expect(assemblerDeps.dataSource).toBe(stepDataSource);
  });

  it('resolves the user service through the shared cache, not a fresh instance', () => {
    // The other half of the drift this module fixes: the contract test built
    // `new UserService(prisma)` while production goes through
    // getOrCreateUserService.
    assemblerCtor.mockClear();

    buildContextStep({ tag: 'prisma' } as never);

    const [deps] = assemblerCtor.mock.calls[0] as [{ userService: unknown }];
    expect(deps.userService).toEqual({ tag: 'user-service' });
  });

  it('resolves the persona resolver through the shared cache, not a fresh instance', () => {
    // Same drift class as the user-service case above: the resolution cache
    // lives on the PersonaResolver instance, so this pipeline must reach the
    // one the invalidation subscriber evicts.
    assemblerCtor.mockClear();

    buildContextStep({ tag: 'prisma' } as never);

    const [deps] = assemblerCtor.mock.calls[0] as [{ personaResolver: unknown }];
    expect(deps.personaResolver).toEqual({ tag: 'persona-resolver' });
  });
});
