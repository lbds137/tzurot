/**
 * Component test: the /user/fact/* correction handlers over REAL PGLite.
 *
 * The unit suite (memoryFacts.test.ts) mocks prisma, so the correct handler's
 * raw INSERT ... ON CONFLICT + supersede transaction never runs against a real
 * database there. This test runs those handlers over real PGLite so the SQL —
 * the corrected-fact INSERT, the supersession UPDATE, the forget/lock writes —
 * is validated end-to-end (rule 7: the seam that mocks can't catch). Only the
 * embedding is stubbed (a fixed 384-dim vector), so no model download is needed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Response } from 'express';
import { type PGlite } from '@electric-sql/pglite';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { generateMemoryFactUuid } from '@tzurot/common-types/utils/deterministicUuid';
import type { ProvisionedRequest } from '../../types.js';
import type { RouteDeps } from '../routeDeps.js';

const USER = '6b2d0f66-0000-4000-8000-00000000d001';
const PERSONA = '6b2d0f66-0000-4000-8000-00000000d002';
const PERSONALITY = '6b2d0f66-0000-4000-8000-00000000d003';
const SYSTEM_PROMPT = '6b2d0f66-0000-4000-8000-00000000d004';

// vi.hoisted so the value is available inside the (hoisted) EmbeddingService mock.
const { FIXED_VECTOR } = vi.hoisted(() => ({
  FIXED_VECTOR: Array.from({ length: 384 }, (_, i) => (i % 7) * 0.01),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});
// Literals inlined (not the USER/PERSONA consts) — vi.mock factories are hoisted
// above the const declarations, so referencing them throws a TDZ error.
vi.mock('./memoryHelpers.js', () => ({
  getDefaultPersonaId: vi.fn().mockResolvedValue('6b2d0f66-0000-4000-8000-00000000d002'),
}));
vi.mock('../../utils/resolveProvisionedUserId.js', () => ({
  resolveProvisionedUserId: vi.fn().mockReturnValue('6b2d0f66-0000-4000-8000-00000000d001'),
}));
vi.mock('../../services/EmbeddingService.js', () => ({
  isEmbeddingServiceAvailable: vi.fn().mockReturnValue(true),
  generateEmbedding: vi.fn().mockResolvedValue(FIXED_VECTOR),
  formatAsVector: (embedding: number[]) => `[${embedding.join(',')}]`,
}));

import {
  handleCorrectFact,
  handleForgetFact,
  handleSetFactLock,
  handleListFacts,
} from './memoryFacts.js';
import { stubRouteResolvers } from '../../test/shared-route-test-utils.js';

describe('memoryFacts handlers (component, PGLite)', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = createTestPGlite();
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) }) as PrismaClient;

    await seedUserWithPersona(prisma, {
      userId: USER,
      personaId: PERSONA,
      discordId: '900000000000000061',
      username: 'correctuser',
      personaName: 'Correct Persona',
      personaPreferredName: 'Corrector',
      personaContent: 'The correction persona',
    });
    await prisma.$executeRaw`
      INSERT INTO system_prompts (id, name, content, updated_at)
      VALUES (${SYSTEM_PROMPT}::uuid, 'C Prompt', 'You are a fact bot.', NOW())
    `;
    await prisma.$executeRaw`
      INSERT INTO personalities (id, name, display_name, slug, system_prompt_id, character_info, personality_traits, owner_id, updated_at)
      VALUES (${PERSONALITY}::uuid, 'CBot', 'C Bot', 'cbot', ${SYSTEM_PROMPT}::uuid, 'C character', 'Precise', ${USER}::uuid, NOW())
    `;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`DELETE FROM memory_facts`;
  });

  function deps(): RouteDeps {
    return { prisma: prisma as unknown as PrismaClient, ...stubRouteResolvers() };
  }

  function reqRes(
    params: Record<string, string> = {},
    body: Record<string, unknown> = {},
    query: Record<string, unknown> = {}
  ) {
    const req = {
      userId: 'discord-c',
      provisionedUserId: USER,
      params,
      body,
      query,
    } as unknown as ProvisionedRequest;
    const json = vi.fn().mockReturnThis();
    const res = { status: vi.fn().mockReturnThis(), json } as unknown as Response;
    return { req, res, json };
  }

  async function seedFact(opts: {
    statement: string;
    isLocked?: boolean;
    salience?: number;
  }): Promise<string> {
    const id = generateMemoryFactUuid(PERSONALITY, PERSONA, opts.statement);
    const vecLiteral = `[${FIXED_VECTOR.join(',')}]`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO memory_facts
         (id, personality_id, persona_id, statement, embedding, salience, tier, is_locked,
          entity_tags, source_memory_ids, valid_from, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, '${vecLiteral}'::vector, $5, 'observed', $6,
          ARRAY['user']::text[], ARRAY['mem-1']::text[], NOW(), NOW(), NOW())`,
      id,
      PERSONALITY,
      PERSONA,
      opts.statement,
      opts.salience ?? 0.7,
      opts.isLocked ?? false
    );
    return id;
  }

  it('correct: writes a superseding corrected-tier fact and marks the old superseded', async () => {
    const oldId = await seedFact({ statement: 'The user lives in Seattle', salience: 0.6 });
    const { req, res, json } = reqRes({ id: oldId }, { statement: 'The user lives in Denver' });

    await handleCorrectFact(deps())(req, res, () => undefined);

    const payload = json.mock.calls[0]?.[0] as {
      fact: { id: string; tier: string; isLocked: boolean };
      supersededFactId: string;
    };
    expect(payload.supersededFactId).toBe(oldId);
    expect(payload.fact.tier).toBe('corrected');
    // The corrected TIER is the extraction shield — no auto-lock, so the user
    // can re-correct without an unlock ceremony.
    expect(payload.fact.isLocked).toBe(false);

    // The old fact is now superseded, pointing at the new one.
    const old = await prisma.memoryFact.findUnique({ where: { id: oldId } });
    expect(old?.supersededAt).not.toBeNull();
    expect(old?.supersededById).toBe(payload.fact.id);

    // The corrected fact carries the old provenance + entity tags, no extraction job.
    const corrected = await prisma.memoryFact.findUnique({ where: { id: payload.fact.id } });
    expect(corrected?.statement).toBe('The user lives in Denver');
    expect(corrected?.sourceMemoryIds).toEqual(['mem-1']);
    expect(corrected?.extractionJobId).toBeNull();

    // Only the corrected fact is active for that scope now.
    const listReq = reqRes({}, {}, { personalityId: PERSONALITY });
    await handleListFacts(deps())(listReq.req, listReq.res, () => undefined);
    const listPayload = listReq.json.mock.calls[0]?.[0] as { facts: { statement: string }[] };
    expect(listPayload.facts.map(f => f.statement)).toEqual(['The user lives in Denver']);
  });

  it('forget: sets forgotten + superseded_at (terminal), removing it from the active list', async () => {
    const factId = await seedFact({ statement: 'The user has a cat named Miso' });
    const { req, res, json } = reqRes({ id: factId });

    await handleForgetFact(deps())(req, res, () => undefined);

    expect(json).toHaveBeenCalledWith({ id: factId, forgotten: true });
    const row = await prisma.memoryFact.findUnique({ where: { id: factId } });
    expect(row?.forgotten).toBe(true);
    expect(row?.supersededAt).not.toBeNull();
    expect(row?.supersededById).toBeNull();
  });

  it('lock: toggles is_locked and the change persists', async () => {
    const factId = await seedFact({ statement: 'The user works as a nurse' });
    const { req, res } = reqRes({ id: factId }, { locked: true });

    await handleSetFactLock(deps())(req, res, () => undefined);

    const row = await prisma.memoryFact.findUnique({ where: { id: factId } });
    expect(row?.isLocked).toBe(true);
  });

  it('correct: forgotten facts are not correctable (404 — not active)', async () => {
    const factId = await seedFact({ statement: 'A stale fact' });
    await prisma.memoryFact.update({ where: { id: factId }, data: { forgotten: true } });
    const { req, res } = reqRes({ id: factId }, { statement: 'A fresh fact' });

    await handleCorrectFact(deps())(req, res, () => undefined);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  // ---- Statement-collision semantics (the id is a content hash) --------------

  it('collision with an ACTIVE locked fact merges instead of clobbering it', async () => {
    // The review-flagged scenario: correct fact B to the exact statement of an
    // existing active LOCKED fact X. X must survive untouched (its lock is the
    // whole point); B converges onto it via supersession.
    const xStatement = 'The user has a cat named Miso';
    const xId = await seedFact({ statement: xStatement, isLocked: true, salience: 0.9 });
    const bId = await seedFact({ statement: 'The user has a companion animal' });

    const { req, res, json } = reqRes({ id: bId }, { statement: xStatement });
    await handleCorrectFact(deps())(req, res, () => undefined);

    // X: completely untouched — still active, still locked, own salience/tier.
    const x = await prisma.memoryFact.findUnique({ where: { id: xId } });
    expect(x?.supersededAt).toBeNull();
    expect(x?.isLocked).toBe(true);
    expect(x?.salience).toBe(0.9);
    expect(x?.tier).toBe('observed');

    // B: superseded, pointing at X (the merge).
    const b = await prisma.memoryFact.findUnique({ where: { id: bId } });
    expect(b?.supersededAt).not.toBeNull();
    expect(b?.supersededById).toBe(xId);

    // Response returns the surviving fact.
    const payload = json.mock.calls[0]?.[0] as { fact: { id: string }; supersededFactId: string };
    expect(payload.fact.id).toBe(xId);
    expect(payload.supersededFactId).toBe(bId);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('collision with an ACTIVE unlocked fact CLAIMS it as the correction (promotes tier)', async () => {
    // The invariant: a correct always leaves the surviving fact shielded from
    // auto-supersession. An unprotected observed row that survives a merge
    // untouched would be extraction-supersedable — silently reopening the
    // death spiral the user just closed — so it gets promoted instead.
    const xStatement = 'The user is vegetarian';
    const xId = await seedFact({ statement: xStatement, salience: 0.4 });
    const bId = await seedFact({ statement: 'The user avoids eating meat' });

    const { req, res, json } = reqRes({ id: bId }, { statement: xStatement });
    await handleCorrectFact(deps())(req, res, () => undefined);

    // X: still active, now corrected-tier (shielded), carries B's provenance.
    const x = await prisma.memoryFact.findUnique({ where: { id: xId } });
    expect(x?.supersededAt).toBeNull();
    expect(x?.tier).toBe('corrected');
    expect(x?.extractionJobId).toBeNull();

    // B: superseded, pointing at X.
    const b = await prisma.memoryFact.findUnique({ where: { id: bId } });
    expect(b?.supersededById).toBe(xId);

    const payload = json.mock.calls[0]?.[0] as { fact: { id: string; tier: string } };
    expect(payload.fact.id).toBe(xId);
    expect(payload.fact.tier).toBe('corrected');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('collision with a DEAD (superseded) fact revives it as the correction', async () => {
    const xStatement = 'The user lives in Portland';
    const xId = await seedFact({ statement: xStatement, salience: 0.4 });
    await prisma.memoryFact.update({
      where: { id: xId },
      data: { supersededAt: new Date('2026-05-01T00:00:00Z') },
    });
    const bId = await seedFact({ statement: 'The user lives somewhere in Oregon' });

    const { req, res, json } = reqRes({ id: bId }, { statement: xStatement });
    await handleCorrectFact(deps())(req, res, () => undefined);

    // X revived as the user's correction: active, corrected-tier, unlocked.
    const x = await prisma.memoryFact.findUnique({ where: { id: xId } });
    expect(x?.supersededAt).toBeNull();
    expect(x?.tier).toBe('corrected');
    expect(x?.isLocked).toBe(false);
    expect(x?.extractionJobId).toBeNull();

    const payload = json.mock.calls[0]?.[0] as { fact: { id: string } };
    expect(payload.fact.id).toBe(xId);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('collision with a FORGOTTEN fact revives it — explicit user assertion overrides a prior forget', async () => {
    const xStatement = 'The user plays the cello';
    const xId = await seedFact({ statement: xStatement });
    await prisma.memoryFact.update({
      where: { id: xId },
      data: { forgotten: true, supersededAt: new Date('2026-05-01T00:00:00Z') },
    });
    const bId = await seedFact({ statement: 'The user plays a string instrument' });

    const { req, res } = reqRes({ id: bId }, { statement: xStatement });
    await handleCorrectFact(deps())(req, res, () => undefined);

    const x = await prisma.memoryFact.findUnique({ where: { id: xId } });
    expect(x?.forgotten).toBe(false); // the user typed it anew — the forget is overridden
    expect(x?.supersededAt).toBeNull();
    expect(x?.tier).toBe('corrected');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
