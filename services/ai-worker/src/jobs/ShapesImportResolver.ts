/**
 * Shapes Import Personality Resolver
 *
 * Multi-strategy personality resolution for shapes.inc imports.
 * For full imports, guards against overwriting another user's personality.
 * For memory_only imports, tries three strategies to find the target:
 *   1. Normalized slug (same-user reimport)
 *   2. Raw source slug (cross-user import into bot-owner's personality)
 *   3. Shapes.inc UUID via customFields.shapesId (canonical match)
 */

import {
  createLogger,
  isBotOwner,
  type PrismaClient,
  type ShapesIncPersonalityConfig,
} from '@tzurot/common-types';
import { createFullPersonality } from './ShapesImportHelpers.js';

const logger = createLogger('ShapesImportResolver');

const RESOLVED_MSG = 'Resolved personality';

export interface ResolvePersonalityOpts {
  prisma: PrismaClient;
  config: ShapesIncPersonalityConfig;
  /** Normalized slug (may have username suffix for non-bot-owners) */
  sourceSlug: string;
  /** Original shapes.inc username (no suffix) */
  rawSourceSlug: string;
  /** Shapes.inc UUID from config.id */
  shapesId: string;
  /** Internal Prisma UUID — NOT the Discord snowflake */
  internalUserId: string;
  discordUserId: string;
  importType: 'full' | 'memory_only';
}

export async function resolvePersonality(
  opts: ResolvePersonalityOpts
): Promise<{ personalityId: string; slug: string }> {
  if (opts.importType !== 'memory_only') {
    return resolveForFullImport(opts);
  }
  return resolveForMemoryOnly(opts);
}

async function resolveForFullImport(
  opts: ResolvePersonalityOpts
): Promise<{ personalityId: string; slug: string }> {
  // Guard: don't overwrite a personality owned by another user
  const existing = await opts.prisma.personality.findFirst({
    where: { slug: opts.sourceSlug },
    select: { id: true, ownerId: true },
  });
  if (
    existing !== null &&
    existing.ownerId !== opts.internalUserId &&
    !isBotOwner(opts.discordUserId)
  ) {
    throw new Error(`Cannot import: personality "${opts.sourceSlug}" is owned by another user.`);
  }
  return createFullPersonality(opts.prisma, opts.config, opts.sourceSlug, opts.internalUserId);
}

async function resolveForMemoryOnly(
  opts: ResolvePersonalityOpts
): Promise<{ personalityId: string; slug: string }> {
  // Strategy 1: Normalized slug (same-user reimport)
  const byNormalized = await opts.prisma.personality.findFirst({
    where: { slug: opts.sourceSlug },
    select: { id: true, slug: true },
  });
  if (byNormalized !== null) {
    logger.info({ slug: opts.sourceSlug, strategy: 'normalized-slug' }, RESOLVED_MSG);
    return { personalityId: byNormalized.id, slug: byNormalized.slug };
  }

  // Strategy 2: Raw source slug (cross-user import — e.g. user imports into
  // bot-owner's personality where slug has no suffix)
  if (opts.rawSourceSlug !== opts.sourceSlug) {
    const byRaw = await opts.prisma.personality.findFirst({
      where: { slug: opts.rawSourceSlug },
      select: { id: true, slug: true },
    });
    if (byRaw !== null) {
      logger.info({ slug: opts.rawSourceSlug, strategy: 'raw-slug' }, RESOLVED_MSG);
      return { personalityId: byRaw.id, slug: byRaw.slug };
    }
  }

  // Strategy 3: Shapes.inc UUID via customFields.shapesId
  if (opts.shapesId !== '') {
    const byShapesId = await opts.prisma.personality.findFirst({
      where: { customFields: { path: ['shapesId'], equals: opts.shapesId } },
      select: { id: true, slug: true },
    });
    if (byShapesId !== null) {
      logger.info({ shapesId: opts.shapesId, strategy: 'shapes-id' }, RESOLVED_MSG);
      return { personalityId: byShapesId.id, slug: byShapesId.slug };
    }
  }

  throw new Error(
    `No personality found for memory_only import. Tried: slug "${opts.sourceSlug}"` +
      (opts.rawSourceSlug !== opts.sourceSlug ? `, raw slug "${opts.rawSourceSlug}"` : '') +
      (opts.shapesId !== '' ? `, shapesId "${opts.shapesId}"` : '') +
      '. Run a full import first.'
  );
}
