/**
 * The single construction point for a production `ContextStep`.
 *
 * This exists because "exactly the production wiring" used to be a COMMENT in
 * the job-chain contract test, sitting above a hand-rebuilt copy of the
 * handler's construction. A comment cannot notice a new constructor argument,
 * and it did not: the copy drifted twice over — it missed the data source that
 * the roster-blurb fetch reads, and it built its own `UserService` where
 * production goes through `getOrCreateUserService`. The test whose stated job
 * is catching wiring gaps was itself the wiring gap.
 *
 * Both callers now build through here, so the fidelity is structural rather
 * than asserted. Anything added to the step's construction reaches the
 * contract test by the only path that cannot be forgotten.
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';
import { getOrCreateUserService, PersonaResolver } from '@tzurot/identity';
import { PrismaContextDataSource } from '../../../services/context/PrismaContextDataSource.js';
import { ContextAssembler } from '../../../services/context/ContextAssembler.js';
import { ContextStep } from './steps/ContextStep.js';

/**
 * Build the ContextStep — the sole context-hydration path: the hydration data
 * source plus the context assembler (user/persona re-derivation + shared
 * history merge against the raw envelope).
 *
 * The data source goes to BOTH: the assembler owns the history merge, and the
 * step reads it directly for the sibling roster's generated blurbs (a lookup
 * over the assembled history, so it has no place inside assembly).
 */
export function buildContextStep(prisma: PrismaClient): ContextStep {
  const dataSource = new PrismaContextDataSource(prisma);
  const assembler = new ContextAssembler({
    dataSource,
    userService: getOrCreateUserService(prisma),
    personaResolver: new PersonaResolver(prisma),
  });
  return new ContextStep(assembler, dataSource);
}
