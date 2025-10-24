#!/usr/bin/env node
/**
 * Qdrant Migration: Personality-scoped → Persona-scoped Collections
 *
 * BEFORE: personality-{personalityId} collections with userId in payload
 * AFTER:  persona-{personaId} collections with personalityId in payload
 *
 * This enables persona-scoped memory isolation where each user can have
 * multiple personas with completely separate memory contexts.
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { QdrantClient } = require('@qdrant/js-client-rest');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

// Initialize Qdrant client
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

// Batch size for scrolling points
const SCROLL_BATCH_SIZE = 100;

/**
 * Load UUID mappings from shapes.inc → current Postgres
 */
function loadUuidMappings() {
  const mappingsPath = path.join(__dirname, 'uuid-mappings.json');

  try {
    const data = fs.readFileSync(mappingsPath, 'utf8');
    const json = JSON.parse(data);
    return json.mappings || {};
  } catch (error) {
    console.log('ℹ️  No UUID mappings file found (uuid-mappings.json), skipping legacy UUID migration');
    return {};
  }
}

/**
 * Get all users with their default personas
 */
async function getUserPersonaMapping() {
  const users = await prisma.user.findMany({
    include: {
      defaultPersonaLink: {
        select: {
          personaId: true
        }
      }
    }
  });

  const mapping = {};
  for (const user of users) {
    if (user.defaultPersonaLink?.personaId) {
      mapping[user.id] = user.defaultPersonaLink.personaId;
    } else {
      console.warn(`⚠️  User ${user.username} (${user.id}) has no default persona!`);
    }
  }

  return mapping;
}

/**
 * Get all personality collections
 */
async function getPersonalityCollections() {
  const response = await qdrant.getCollections();
  return response.collections
    .filter(c => c.name.startsWith('personality-'))
    .map(c => c.name);
}

/**
 * Create a persona collection if it doesn't exist
 */
async function ensurePersonaCollection(personaId, referenceCollection) {
  const collectionName = `persona-${personaId}`;

  try {
    await qdrant.getCollection(collectionName);
    console.log(`  ✓ Collection ${collectionName} already exists`);
    return collectionName;
  } catch (error) {
    // Collection doesn't exist, create it
    console.log(`  ⚙️  Creating collection ${collectionName}`);

    // Get config from reference collection
    const refConfig = await qdrant.getCollection(referenceCollection);

    await qdrant.createCollection(collectionName, {
      vectors: {
        size: refConfig.config.params.vectors.size,
        distance: refConfig.config.params.vectors.distance
      },
      on_disk_payload: true,
    });

    console.log(`  ✓ Created collection ${collectionName}`);
    return collectionName;
  }
}

/**
 * Scroll through all points in a collection
 */
async function* scrollCollection(collectionName) {
  let offset = null;
  let hasMore = true;

  while (hasMore) {
    const response = await qdrant.scroll(collectionName, {
      limit: SCROLL_BATCH_SIZE,
      offset: offset,
      with_payload: true,
      with_vector: true,
    });

    yield response.points;

    offset = response.next_page_offset;
    hasMore = offset !== null && offset !== undefined;
  }
}

/**
 * Migrate a personality collection to persona-scoped collections
 */
async function migratePersonalityCollection(collectionName, userPersonaMapping, uuidMappings) {
  console.log(`\n📦 Migrating ${collectionName}...`);

  // Extract personality ID from collection name
  const personalityId = collectionName.replace('personality-', '');

  // Get personality info
  const personality = await prisma.personality.findUnique({
    where: { id: personalityId },
    select: { name: true, slug: true }
  });

  if (!personality) {
    console.error(`❌ Personality ${personalityId} not found in database!`);
    return { migrated: 0, skipped: 0, totalOriginal: 0 };
  }

  console.log(`   Personality: ${personality.name} (${personality.slug})`);

  // Group points by userId (applying UUID mappings)
  const pointsByUser = {};
  let totalPoints = 0;
  let mappedCount = 0;
  let refusalSpamCount = 0;

  // Refusal spam patterns to filter out
  const refusalPatterns = [
    'I cannot generate',
    'I cannot provide',
    'I cannot create',
    'I cannot assist',
    'I apologize, but I cannot',
    'I\'m not able to',
    'I cannot help with',
    'I\'m unable to'
  ];

  console.log(`   Scanning points...`);

  for await (const batch of scrollCollection(collectionName)) {
    for (const point of batch) {
      totalPoints++;
      let userId = point.payload.userId;

      if (!userId) {
        console.warn(`   ⚠️  Point ${point.id} has no userId, skipping`);
        continue;
      }

      // Filter out refusal spam (garbage memories from LLM summarizer false positives)
      // Only match refusal patterns at the START of content (first 50 chars)
      const content = point.payload.content || '';
      const contentStart = content.substring(0, 50).toLowerCase();
      let isRefusalSpam = false;

      for (const pattern of refusalPatterns) {
        if (contentStart.includes(pattern.toLowerCase())) {
          isRefusalSpam = true;
          refusalSpamCount++;
          break;
        }
      }

      if (isRefusalSpam) {
        continue; // Skip this garbage memory
      }

      // Apply UUID mapping if exists (old shapes.inc UUID → current Postgres UUID)
      const originalUserId = userId;
      if (uuidMappings[userId]) {
        userId = uuidMappings[userId].newUserId;
        mappedCount++;
      }

      if (!pointsByUser[userId]) {
        pointsByUser[userId] = [];
      }

      // Store point with metadata about original userId
      pointsByUser[userId].push({
        ...point,
        _originalUserId: originalUserId
      });
    }
  }

  if (mappedCount > 0) {
    console.log(`   ✓ Mapped ${mappedCount} points from old UUIDs to current users`);
  }

  if (refusalSpamCount > 0) {
    console.log(`   ✓ Filtered ${refusalSpamCount} refusal spam memories`);
  }

  console.log(`   Total points: ${totalPoints}`);
  console.log(`   Unique users: ${Object.keys(pointsByUser).length}`);

  // Migrate points for each user
  let migratedCount = 0;
  let skippedCount = 0;

  for (const [userId, points] of Object.entries(pointsByUser)) {
    const personaId = userPersonaMapping[userId];

    if (!personaId) {
      console.warn(`   ⚠️  No persona found for user ${userId}, skipping ${points.length} points`);
      skippedCount += points.length;
      continue;
    }

    // Ensure persona collection exists
    const targetCollection = await ensurePersonaCollection(personaId, collectionName);

    // Transform points: add personalityId, keep userId for backward compat
    const transformedPoints = points.map(point => ({
      id: point.id,
      vector: point.vector,
      payload: {
        ...point.payload,
        // NEW: Add personalityId for filtering
        personalityId: personalityId,
        // NEW: Explicitly set personaId (replacing userId as primary identifier)
        personaId: personaId,
        // KEEP: userId for backward compatibility and debugging
        userId: userId,
      }
    }));

    // Upsert points in batches to avoid Qdrant payload size limit (33MB)
    const UPSERT_BATCH_SIZE = 100;
    for (let i = 0; i < transformedPoints.length; i += UPSERT_BATCH_SIZE) {
      const batch = transformedPoints.slice(i, i + UPSERT_BATCH_SIZE);
      await qdrant.upsert(targetCollection, {
        wait: true,
        points: batch
      });

      if (transformedPoints.length > UPSERT_BATCH_SIZE) {
        console.log(`   ⏳ Upserting batch ${Math.floor(i / UPSERT_BATCH_SIZE) + 1}/${Math.ceil(transformedPoints.length / UPSERT_BATCH_SIZE)}`);
      }
    }

    migratedCount += points.length;
    console.log(`   ✓ Migrated ${points.length} points from user ${userId} to ${targetCollection}`);
  }

  return {
    migrated: migratedCount,
    skipped: skippedCount,
    totalOriginal: totalPoints,
    refusalSpamFiltered: refusalSpamCount
  };
}

/**
 * Validate migration results
 */
async function validateMigration(originalCounts, newCollections, totalSkipped, totalRefusalSpam) {
  console.log(`\n🔍 Validating migration...`);

  let totalOriginal = 0;
  let totalNew = 0;

  for (const count of Object.values(originalCounts)) {
    totalOriginal += count;
  }

  for (const collectionName of newCollections) {
    const info = await qdrant.getCollection(collectionName);
    const count = info.points_count;
    totalNew += count;
    console.log(`   ${collectionName}: ${count} points`);
  }

  const expectedTotal = totalOriginal - totalSkipped - totalRefusalSpam;

  console.log(`\n   Original total: ${totalOriginal}`);
  console.log(`   Skipped (no persona): ${totalSkipped}`);
  console.log(`   Filtered (refusal spam): ${totalRefusalSpam}`);
  console.log(`   Expected migrated: ${expectedTotal}`);
  console.log(`   Actual migrated:   ${totalNew}`);

  if (expectedTotal === totalNew) {
    console.log(`   ✅ Point counts match!`);
    return true;
  } else {
    console.error(`   ❌ Point count mismatch! Difference: ${Math.abs(expectedTotal - totalNew)} points`);
    return false;
  }
}

/**
 * Main migration process
 */
async function main() {
  console.log(`
================================================================================
QDRANT MIGRATION: Personality → Persona Collections
================================================================================
  `);

  try {
    // Step 1: Load UUID mappings from shapes.inc imports
    console.log(`📋 Loading UUID mappings (shapes.inc → current Postgres)...`);
    const uuidMappings = loadUuidMappings();
    const mappingCount = Object.keys(uuidMappings).length;
    if (mappingCount > 0) {
      console.log(`   Found ${mappingCount} UUID mapping(s):`);
      for (const [oldId, mapping] of Object.entries(uuidMappings)) {
        console.log(`     ${oldId} → ${mapping.newUserId} (Discord: ${mapping.discordId}) ${mapping.note ? '- ' + mapping.note : ''}`);
      }
    } else {
      console.log(`   No UUID mappings configured`);
    }

    // Step 2: Get user → persona mapping from database
    console.log(`\n📋 Loading user→persona mappings from database...`);
    const userPersonaMapping = await getUserPersonaMapping();
    console.log(`   Found ${Object.keys(userPersonaMapping).length} users with default personas`);

    // Step 3: Get all personality collections
    console.log(`\n📋 Discovering personality collections...`);
    const personalityCollections = await getPersonalityCollections();
    console.log(`   Found ${personalityCollections.length} personality collections:`);
    for (const name of personalityCollections) {
      const info = await qdrant.getCollection(name);
      console.log(`     - ${name} (${info.points_count} points)`);
    }

    if (personalityCollections.length === 0) {
      console.log(`\n✅ No personality collections to migrate!`);
      return;
    }

    // Step 4: Migrate each collection
    const originalCounts = {};
    const newCollections = new Set();
    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalRefusalSpam = 0;

    for (const collectionName of personalityCollections) {
      const result = await migratePersonalityCollection(collectionName, userPersonaMapping, uuidMappings);
      originalCounts[collectionName] = result.totalOriginal;
      totalMigrated += result.migrated;
      totalSkipped += result.skipped;
      totalRefusalSpam += result.refusalSpamFiltered;

      // Track new collections created
      for (const personaId of Object.values(userPersonaMapping)) {
        newCollections.add(`persona-${personaId}`);
      }
    }

    // Step 4: Validate migration
    const valid = await validateMigration(originalCounts, Array.from(newCollections), totalSkipped, totalRefusalSpam);

    // Step 5: Summary
    console.log(`
================================================================================
MIGRATION SUMMARY
================================================================================
UUID mappings applied: ${mappingCount}
Original collections: ${personalityCollections.length}
New persona collections: ${newCollections.size}

Points migrated: ${totalMigrated}
Points skipped (no persona): ${totalSkipped}
Points filtered (refusal spam): ${totalRefusalSpam}

Validation: ${valid ? '✅ PASSED' : '❌ FAILED'}
================================================================================
    `);

    if (valid) {
      console.log(`\n✅ Migration completed successfully!`);
      console.log(`\n⚠️  IMPORTANT: Keep personality-* collections as backup for 1 week`);
      console.log(`   Delete them only after confirming production is stable.`);
    } else {
      console.log(`\n❌ Migration validation failed!`);
      console.log(`   Review the output above and check for missing points.`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`\n❌ Migration failed:`, error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run migration
main().catch(console.error);
