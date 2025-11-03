#!/usr/bin/env tsx
/**
 * Populate shapes_persona_mappings table from uuid-mappings.json
 *
 * This script:
 * - Reads uuid-mappings.json with known shapes.inc user UUID → postgres user UUID mappings
 * - Looks up each user's default persona
 * - Creates entries in shapes_persona_mappings table
 * - Updates existing memories with NULL persona_id to link them to the persona
 */

import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'fs';
import path from 'path';
import { createLogger } from '../packages/common-types/src/logger.js';

const logger = createLogger('PopulateShapesMappings');
const prisma = new PrismaClient();

interface UUIDMapping {
  newUserId: string;
  discordId: string;
  note: string;
  oldMemories?: number;
  newMemories?: number;
  discoveredVia: string;
}

interface UUIDMappingsFile {
  description: string;
  mappings: Record<string, UUIDMapping>;
}

const DRY_RUN = process.env.DRY_RUN === 'true';

async function main() {
  logger.info('=== Populating shapes_persona_mappings ===');
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will write to database)'}`);

  // Load uuid-mappings.json
  const mappingsPath = path.join(process.cwd(), 'scripts', 'uuid-mappings.json');
  const fileContent = await fs.readFile(mappingsPath, 'utf-8');
  const mappingsFile: UUIDMappingsFile = JSON.parse(fileContent);

  logger.info(`Loaded ${Object.keys(mappingsFile.mappings).length} UUID mappings`);

  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const [shapesUserId, mapping] of Object.entries(mappingsFile.mappings)) {
    logger.info(`\n🔄 Processing: ${shapesUserId}`);
    logger.info(`  → User: ${mapping.newUserId} (Discord: ${mapping.discordId})`);
    logger.info(`  → Note: ${mapping.note}`);

    try {
      // Find the user by Discord ID (more reliable than UUID which may have changed during migration)
      const userWithPersona = await prisma.user.findUnique({
        where: { discordId: mapping.discordId },
        include: {
          defaultPersonaLink: {
            include: {
              persona: true,
            },
          },
        },
      });

      if (!userWithPersona) {
        logger.warn(
          `  ⚠️  User with Discord ID ${mapping.discordId} not found in database, skipping`
        );
        skipped++;
        continue;
      }

      logger.info(`  → Found user: ${userWithPersona.id} (${userWithPersona.username})`);

      if (!userWithPersona.defaultPersonaLink) {
        logger.warn(`  ⚠️  User ${mapping.newUserId} has no default persona, skipping`);
        skipped++;
        continue;
      }

      const personaId = userWithPersona.defaultPersonaLink.persona.id;
      logger.info(`  → Persona: ${personaId}`);

      // Check if mapping already exists
      const existing = await prisma.shapesPersonaMapping.findUnique({
        where: { shapesUserId: shapesUserId },
      });

      if (existing) {
        logger.info(`  ✅ Mapping already exists, skipping`);
        skipped++;
        continue;
      }

      if (!DRY_RUN) {
        // Create the mapping
        await prisma.shapesPersonaMapping.create({
          data: {
            shapesUserId: shapesUserId,
            personaId: personaId,
            verificationStatus: 'admin_verified',
            mappedBy: mapping.newUserId, // Track who this was mapped by
          },
        });

        logger.info(`  ✅ Created mapping: ${shapesUserId} → ${personaId}`);
        created++;

        // Update any existing memories with this legacy_shapes_user_id to link them
        const updateResult = await prisma.$executeRaw`
          UPDATE memories
          SET persona_id = ${personaId}::uuid
          WHERE legacy_shapes_user_id = ${shapesUserId}::uuid
            AND persona_id IS NULL
        `;

        if (updateResult > 0) {
          logger.info(`  🔗 Updated ${updateResult} memories to link to persona`);
          updated += updateResult;
        }
      } else {
        logger.info(`  [DRY RUN] Would create mapping: ${shapesUserId} → ${personaId}`);
        created++;
      }
    } catch (error) {
      logger.error({ err: error, shapesUserId }, 'Failed to process mapping');
      skipped++;
    }
  }

  // Summary
  logger.info('\n=== Summary ===');
  logger.info(`Mappings created: ${created}`);
  logger.info(`Mappings skipped: ${skipped}`);
  logger.info(`Memories updated: ${updated}`);
  logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);

  await prisma.$disconnect();
}

main().catch(error => {
  logger.error({ err: error }, 'Fatal error');
  process.exit(1);
});
