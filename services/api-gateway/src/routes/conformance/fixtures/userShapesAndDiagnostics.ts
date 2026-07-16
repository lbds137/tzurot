/**
 * Conformance fixtures: user-audience shapes.inc routes + diagnostic GETs.
 *
 * Shapes routes that probe the external shapes.inc service (store-auth
 * preflight, catalog listing, import-start fetch) are skipped; everything
 * that operates on locally-stored rows (credential status/delete, job
 * listings, export-start enqueue) runs for real. Diagnostic logs have no
 * create API (the ai-worker flight recorder writes them), so rows are
 * inserted directly.
 */

import { CREDENTIAL_SERVICES, CREDENTIAL_TYPES } from '@tzurot/common-types/types/shapes-import';
import { generateUserCredentialUuid } from '@tzurot/common-types/utils/deterministicUuid';
import { encryptApiKey } from '@tzurot/common-types/utils/encryption';
import type { ConformanceEntry, SeedContext } from './types.js';

/** Store an encrypted shapes.inc session-cookie credential for the actor. */
async function seedShapesCredential(ctx: SeedContext): Promise<void> {
  const encrypted = encryptApiKey('conf-harness-session-cookie');
  const id = generateUserCredentialUuid(
    ctx.actorUserId,
    CREDENTIAL_SERVICES.SHAPES_INC,
    CREDENTIAL_TYPES.SESSION_COOKIE
  );
  await ctx.prisma.userCredential.upsert({
    where: {
      userId_service_credentialType: {
        userId: ctx.actorUserId,
        service: CREDENTIAL_SERVICES.SHAPES_INC,
        credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
      },
    },
    update: { iv: encrypted.iv, content: encrypted.content, tag: encrypted.tag },
    create: {
      id,
      userId: ctx.actorUserId,
      service: CREDENTIAL_SERVICES.SHAPES_INC,
      credentialType: CREDENTIAL_TYPES.SESSION_COOKIE,
      iv: encrypted.iv,
      content: encrypted.content,
      tag: encrypted.tag,
    },
  });
}

export const userShapesFixtures: Record<string, ConformanceEntry> = {
  storeShapesAuth: {
    skip: 'Preflights the supplied session cookie against the live shapes.inc service before storing.',
  },

  deleteShapesAuth: {
    seed: async ctx => {
      await seedShapesCredential(ctx);
    },
  },

  getShapesAuthStatus: {
    seed: async ctx => {
      await seedShapesCredential(ctx);
    },
  },

  listShapes: {
    skip: 'Queries the external shapes.inc catalog — no success path without the live service.',
  },

  startShapesImport: {
    skip: 'Fetches shape data from the live shapes.inc service before enqueueing the import job.',
  },

  listShapesImportJobs: {
    seed: async ctx => {
      await ctx.prisma.importJob.create({
        data: {
          id: '14b00000-0000-4000-8000-000000000001',
          userId: ctx.actorUserId,
          sourceSlug: 'conf-import-shape',
          sourceService: 'shapes_inc',
          status: 'completed',
          memoriesImported: 3,
        },
      });
    },
  },

  startShapesExport: {
    seed: async ctx => {
      await seedShapesCredential(ctx);
    },
    body: { slug: 'conf-export-shape', format: 'json' },
  },

  listShapesExportJobs: {
    seed: async ctx => {
      await ctx.prisma.exportJob.create({
        data: {
          id: '14b00000-0000-4000-8000-000000000002',
          userId: ctx.actorUserId,
          sourceSlug: 'conf-export-listed',
          sourceService: 'shapes_inc',
          status: 'completed',
          format: 'json',
          fileName: 'conf-export-listed.json',
          fileSizeBytes: 42,
          // A completed job needs a downloadToken so the list route builds the
          // populated downloadUrl branch.
          downloadToken: 'e'.repeat(64),
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        },
      });
    },
  },
};

/** Insert a diagnostic flight-recorder row keyed for one lookup shape. */
async function seedDiagnosticLog(
  ctx: SeedContext,
  options: { requestId: string; triggerMessageId?: string; responseMessageIds?: string[] }
): Promise<void> {
  await ctx.prisma.llmDiagnosticLog.create({
    data: {
      requestId: options.requestId,
      triggerMessageId: options.triggerMessageId,
      responseMessageIds: options.responseMessageIds ?? [],
      userId: ctx.actorDiscordId,
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
      durationMs: 1234,
      data: { meta: { source: 'conformance-harness' } },
    },
  });
}

export const userDiagnosticFixtures: Record<string, ConformanceEntry> = {
  getRecentDiagnostics: {
    seed: async ctx => {
      await seedDiagnosticLog(ctx, { requestId: 'conf-diag-recent' });
    },
  },

  getDiagnosticByMessage: {
    seed: async ctx => {
      await seedDiagnosticLog(ctx, {
        requestId: 'conf-diag-by-message',
        triggerMessageId: '810000000000000001',
      });
    },
    params: { messageId: '810000000000000001' },
  },

  getDiagnosticByResponse: {
    seed: async ctx => {
      await seedDiagnosticLog(ctx, {
        requestId: 'conf-diag-by-response',
        responseMessageIds: ['810000000000000002'],
      });
    },
    params: { messageId: '810000000000000002' },
  },

  getDiagnosticByRequestId: {
    seed: async ctx => {
      await seedDiagnosticLog(ctx, { requestId: 'conf-diag-by-request' });
    },
    params: { requestId: 'conf-diag-by-request' },
  },
};
