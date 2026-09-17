/**
 * Component test: recent-days digest store (real SQL).
 *
 * The write guards rest on `IS NOT DISTINCT FROM` against nullable
 * timestamps and a CASE expression computing both `digest_attempts` and
 * `digest_status` together — semantics a mock cannot model faithfully.
 */

import type { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@tzurot/common-types/services/prisma';
import { createTestPGlite, loadPGliteSchema, seedUserWithPersona } from '@tzurot/test-utils';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  materializePendingRows,
  storeDigestSuccess,
  recordDigestFailure,
} from './recentDaysDigestStore.js';

const OWNER_ID = '4f9b0f66-2222-4000-8000-00000000000a';
const PERSONA_ID = '4f9b0f66-2222-4000-8000-00000000000b';
const PERSONALITY_ID = '4f9b0f66-2222-4000-8000-00000000000c';

let pglite: PGlite;
let prisma: PrismaClient;

async function seedPersonality(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO personalities
      (id, name, slug, character_info, personality_traits, owner_id, updated_at)
    VALUES (${PERSONALITY_ID}::uuid, 'Nova', 'nova', 'info', 'traits', ${OWNER_ID}::uuid, NOW())
  `;
}

interface DigestRow {
  id: string;
  digest_status: string | null;
  digest_attempts: number;
  digest_text: string | null;
  source_watermark: Date | null;
  requested_at: Date | null;
}

async function readRow(id: string): Promise<DigestRow | undefined> {
  const rows = await prisma.$queryRaw<DigestRow[]>`
    SELECT id, digest_status, digest_attempts, digest_text, source_watermark, requested_at
    FROM persona_personality_digests WHERE id = ${id}::uuid
  `;
  return rows[0];
}

beforeAll(async () => {
  pglite = createTestPGlite();
  await pglite.exec(loadPGliteSchema());
  prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  await seedUserWithPersona(prisma, {
    userId: OWNER_ID,
    personaId: PERSONA_ID,
    discordId: '300000000000000001',
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  await pglite.close();
});

beforeEach(async () => {
  await prisma.$executeRaw`DELETE FROM persona_personality_digests`;
  await prisma.$executeRaw`DELETE FROM personalities`;
  await seedPersonality();
});

describe('materializePendingRows', () => {
  it('inserts a pending row for a never-generated pair and returns its id', async () => {
    const ids = await materializePendingRows(prisma, [
      { personaId: PERSONA_ID, personalityId: PERSONALITY_ID, digestId: null },
    ]);
    const id = ids.get(`${PERSONA_ID}:${PERSONALITY_ID}`);
    expect(id).toBeDefined();
    const row = await readRow(id!);
    expect(row?.digest_status).toBe('pending');
  });

  it('passes through an existing digestId without inserting', async () => {
    const ids = await materializePendingRows(prisma, [
      { personaId: PERSONA_ID, personalityId: PERSONALITY_ID, digestId: 'existing-id' },
    ]);
    expect(ids.get(`${PERSONA_ID}:${PERSONALITY_ID}`)).toBe('existing-id');
    const count = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::int AS count FROM persona_personality_digests
    `;
    expect(Number(count[0].count)).toBe(0);
  });
});

describe('storeDigestSuccess', () => {
  it('is a no-op when seenRequestedAt is stale (a purge landed between select and write)', async () => {
    const ids = await materializePendingRows(prisma, [
      { personaId: PERSONA_ID, personalityId: PERSONALITY_ID, digestId: null },
    ]);
    const id = ids.get(`${PERSONA_ID}:${PERSONALITY_ID}`)!;
    // Simulate a purge landing mid-generation: it stamps requested_at.
    await prisma.$executeRaw`
      UPDATE persona_personality_digests SET requested_at = NOW() WHERE id = ${id}::uuid
    `;

    const affected = await storeDigestSuccess(prisma, {
      id,
      seenRequestedAt: null, // what the sweep saw BEFORE the purge
      text: 'a digest',
      model: 'z-ai/glm-5.2',
      promptVersion: 1,
      sourceWatermark: new Date(),
      windowStart: new Date(),
      sourceRowCount: 3,
      sourceRowIds: ['r1', 'r2', 'r3'],
      sourceEpoch: null,
    });

    expect(affected).toBe(0);
    const row = await readRow(id);
    expect(row?.digest_status).toBe('pending');
    expect(row?.digest_text).toBeNull();
  });

  it('is a no-op against a deleted id', async () => {
    const affected = await storeDigestSuccess(prisma, {
      id: '4f9b0f66-2222-4000-8000-0000000000ff',
      seenRequestedAt: null,
      text: 'a digest',
      model: 'z-ai/glm-5.2',
      promptVersion: 1,
      sourceWatermark: new Date(),
      windowStart: new Date(),
      sourceRowCount: 1,
      sourceRowIds: ['r1'],
      sourceEpoch: null,
    });
    expect(affected).toBe(0);
  });

  it('writes the digest and clears failure state on a matching guard', async () => {
    const ids = await materializePendingRows(prisma, [
      { personaId: PERSONA_ID, personalityId: PERSONALITY_ID, digestId: null },
    ]);
    const id = ids.get(`${PERSONA_ID}:${PERSONALITY_ID}`)!;
    const watermark = new Date('2026-09-10T00:00:00.000Z');

    const affected = await storeDigestSuccess(prisma, {
      id,
      seenRequestedAt: null,
      text: 'Jules and Nova talked.',
      model: 'z-ai/glm-5.2',
      promptVersion: 1,
      sourceWatermark: watermark,
      windowStart: watermark,
      sourceRowCount: 1,
      sourceRowIds: ['r1'],
      sourceEpoch: null,
    });

    expect(affected).toBe(1);
    const row = await readRow(id);
    expect(row?.digest_status).toBe('done');
    expect(row?.digest_text).toBe('Jules and Nova talked.');
    expect(row?.digest_attempts).toBe(0);
  });
});

describe('recordDigestFailure', () => {
  async function seedPendingRow(): Promise<string> {
    const ids = await materializePendingRows(prisma, [
      { personaId: PERSONA_ID, personalityId: PERSONALITY_ID, digestId: null },
    ]);
    return ids.get(`${PERSONA_ID}:${PERSONALITY_ID}`)!;
  }

  it('a purge-marked (pending) row already at attempts 3, SAME watermark and version, restarts at 1 (not dead)', async () => {
    // Isolates the `digest_status <> 'pending'` guard arm: watermark and
    // version both match what recordDigestFailure is about to write, so the
    // only thing distinguishing this row from a genuine 3rd consecutive
    // failure is its `pending` status (set by a purge). Without that arm,
    // attempts would jump straight to 4 and read as `dead`.
    const id = await seedPendingRow();
    const watermark = new Date('2026-09-10T00:00:00.000Z');
    await prisma.$executeRaw`
      UPDATE persona_personality_digests
      SET digest_attempts = 3, digest_status = 'pending', source_watermark = ${watermark}::timestamptz,
          digest_prompt_version = 1
      WHERE id = ${id}::uuid
    `;

    const affected = await recordDigestFailure(prisma, {
      id,
      seenRequestedAt: null,
      attemptedWatermark: watermark,
      promptVersion: 1,
      errorClass: 'parse_failure',
    });

    expect(affected).toBe(1);
    const row = await readRow(id);
    expect(row?.digest_attempts).toBe(1);
    expect(row?.digest_status).toBe('failed');
  });

  it('three failures against the same watermark and version mark the row dead', async () => {
    const id = await seedPendingRow();
    const watermark = new Date('2026-09-10T00:00:00.000Z');
    // First failure on a `pending` row restarts the count at 1 (not `pending`
    // after this write, so the next call's guard arm can trigger).
    await recordDigestFailure(prisma, {
      id,
      seenRequestedAt: null,
      attemptedWatermark: watermark,
      promptVersion: 1,
      errorClass: 'parse_failure',
    });
    await recordDigestFailure(prisma, {
      id,
      seenRequestedAt: null,
      attemptedWatermark: watermark,
      promptVersion: 1,
      errorClass: 'parse_failure',
    });
    await recordDigestFailure(prisma, {
      id,
      seenRequestedAt: null,
      attemptedWatermark: watermark,
      promptVersion: 1,
      errorClass: 'parse_failure',
    });

    const row = await readRow(id);
    expect(row?.digest_attempts).toBe(3);
    expect(row?.digest_status).toBe('dead');
  });

  it('a fourth failure with a MOVED watermark restarts at 1, status failed', async () => {
    const id = await seedPendingRow();
    const watermark = new Date('2026-09-10T00:00:00.000Z');
    for (let i = 0; i < 3; i++) {
      await recordDigestFailure(prisma, {
        id,
        seenRequestedAt: null,
        attemptedWatermark: watermark,
        promptVersion: 1,
        errorClass: 'parse_failure',
      });
    }
    const deadRow = await readRow(id);
    expect(deadRow?.digest_status).toBe('dead');

    const newWatermark = new Date('2026-09-11T00:00:00.000Z');
    await recordDigestFailure(prisma, {
      id,
      seenRequestedAt: null,
      attemptedWatermark: newWatermark,
      promptVersion: 1,
      errorClass: 'parse_failure',
    });

    const row = await readRow(id);
    expect(row?.digest_attempts).toBe(1);
    expect(row?.digest_status).toBe('failed');
  });
});
