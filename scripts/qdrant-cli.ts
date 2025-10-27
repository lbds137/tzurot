#!/usr/bin/env tsx
/**
 * Qdrant CLI - Reusable tool for inspecting and managing Qdrant collections
 *
 * Usage:
 *   pnpm qdrant list
 *   pnpm qdrant inspect <collection>
 *   pnpm qdrant search <collection> <query> [limit]
 *   pnpm qdrant count <collection>
 *   pnpm qdrant sample <collection> [limit]
 *   pnpm qdrant delete <collection> --force
 */

import { QdrantClient } from '@qdrant/js-client-rest';
import { config as loadEnv } from 'dotenv';

loadEnv();

if (!process.env.QDRANT_URL || !process.env.QDRANT_API_KEY) {
  console.error('❌ Missing QDRANT_URL or QDRANT_API_KEY environment variables');
  process.exit(1);
}

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

/**
 * List all collections
 */
async function listCollections() {
  const response = await qdrant.getCollections();

  console.log('📦 Qdrant Collections:\n');

  if (response.collections.length === 0) {
    console.log('  (no collections)');
    return;
  }

  // Get detailed info for each collection to get accurate point counts
  const collectionsWithCounts = await Promise.all(
    response.collections.map(async (c) => {
      try {
        const detail = await qdrant.getCollection(c.name);
        return { name: c.name, points_count: detail.points_count };
      } catch (error) {
        return { name: c.name, points_count: 0 };
      }
    })
  );

  // Group by type
  const personality = collectionsWithCounts.filter(c => c.name.startsWith('personality-'));
  const persona = collectionsWithCounts.filter(c => c.name.startsWith('persona-') && !c.name.startsWith('persona-legacy-'));
  const legacy = collectionsWithCounts.filter(c => c.name.startsWith('persona-legacy-'));
  const other = collectionsWithCounts.filter(c =>
    !c.name.startsWith('personality-') &&
    !c.name.startsWith('persona-')
  );

  if (personality.length > 0) {
    console.log('🔮 Personality Collections (OLD FORMAT - personality-{uuid}):');
    personality.forEach(c => console.log(`  - ${c.name} (${c.points_count} points)`));
    console.log('');
  }

  if (persona.length > 0) {
    console.log('👤 Persona Collections (NEW FORMAT - persona-{uuid}):');
    persona.forEach(c => console.log(`  - ${c.name} (${c.points_count || 0} points)`));
    console.log('');
  }

  if (legacy.length > 0) {
    console.log('🗄️  Legacy Collections (shapes.inc imports - persona-legacy-{uuid}):');
    legacy.forEach(c => console.log(`  - ${c.name} (${c.points_count || 0} points)`));
    console.log('');
  }

  if (other.length > 0) {
    console.log('❓ Other Collections:');
    other.forEach(c => console.log(`  - ${c.name} (${c.points_count || 0} points)`));
    console.log('');
  }

  const totalPoints = collectionsWithCounts.reduce((sum, c) => sum + c.points_count, 0);
  console.log(`Total: ${response.collections.length} collections, ${totalPoints} points`);
}

/**
 * Inspect collection details
 */
async function inspectCollection(collectionName: string) {
  try {
    const collection = await qdrant.getCollection(collectionName);

    console.log(`\n🔍 Collection: ${collectionName}\n`);
    console.log('═'.repeat(80));
    console.log('STATUS:');
    console.log('═'.repeat(80));
    console.log(`  Status: ${collection.status}`);
    console.log(`  Optimizer: ${collection.optimizer_status}`);
    console.log(`  Points: ${collection.points_count}`);
    console.log(`  Indexed vectors: ${collection.indexed_vectors_count}`);
    console.log(`  Segments: ${collection.segments_count}`);

    console.log('\n' + '═'.repeat(80));
    console.log('VECTOR CONFIG:');
    console.log('═'.repeat(80));
    console.log(`  Size: ${collection.config.params.vectors.size}`);
    console.log(`  Distance: ${collection.config.params.vectors.distance}`);

    if (collection.payload_schema && Object.keys(collection.payload_schema).length > 0) {
      console.log('\n' + '═'.repeat(80));
      console.log('PAYLOAD SCHEMA (indexes):');
      console.log('═'.repeat(80));
      Object.entries(collection.payload_schema).forEach(([field, schema]) => {
        const points = (schema as any).points || 0;
        const percentage = ((points / collection.points_count) * 100).toFixed(1);
        console.log(`  ${field}:`);
        console.log(`    Type: ${(schema as any).data_type}`);
        console.log(`    Indexed: ${points} / ${collection.points_count} (${percentage}%)`);
      });
    }

  } catch (error) {
    console.error(`❌ Collection "${collectionName}" not found`);
    process.exit(1);
  }
}

/**
 * Count points in collection
 */
async function countPoints(collectionName: string) {
  try {
    const collection = await qdrant.getCollection(collectionName);
    console.log(`📊 ${collectionName}: ${collection.points_count} points`);
  } catch (error) {
    console.error(`❌ Collection "${collectionName}" not found`);
    process.exit(1);
  }
}

/**
 * Delete a collection
 */
async function deleteCollection(collectionName: string, force: boolean = false) {
  try {
    // Get collection info first
    const collection = await qdrant.getCollection(collectionName);
    const pointCount = collection.points_count;

    console.log(`\n🗑️  Delete Collection: ${collectionName}`);
    console.log(`   Points: ${pointCount}`);
    console.log('');

    if (!force) {
      console.error('❌ Safety check: Use --force to confirm deletion');
      console.error(`   This will permanently delete ${pointCount} points!`);
      console.error('');
      console.error(`   Run: pnpm qdrant delete ${collectionName} --force`);
      process.exit(1);
    }

    console.log(`⚠️  Deleting collection ${collectionName}...`);
    await qdrant.deleteCollection(collectionName);
    console.log(`✅ Collection deleted successfully`);
    console.log('');

  } catch (error) {
    console.error(`❌ Collection "${collectionName}" not found or delete failed`);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Sample random points from collection
 */
async function samplePoints(collectionName: string, limit: number = 5) {
  try {
    const response = await qdrant.scroll(collectionName, {
      limit,
      with_payload: true,
      with_vector: false,
    });

    console.log(`\n📋 Sample points from ${collectionName}:\n`);

    response.points.forEach((point, idx) => {
      console.log(`${idx + 1}. ID: ${point.id}`);
      console.log(`   Payload:`);
      Object.entries(point.payload || {}).forEach(([key, value]) => {
        const valueStr = typeof value === 'string' && value.length > 100
          ? value.substring(0, 100) + '...'
          : JSON.stringify(value);
        console.log(`     ${key}: ${valueStr}`);
      });
      console.log('');
    });

  } catch (error) {
    console.error(`❌ Collection "${collectionName}" not found`);
    process.exit(1);
  }
}

/**
 * Search collection by text query
 */
async function searchCollection(collectionName: string, query: string, limit: number = 10) {
  try {
    // First, we need to generate an embedding for the query
    // For now, just do a scroll and filter by content
    console.log(`🔍 Searching ${collectionName} for: "${query}"\n`);

    let found = 0;
    let offset: string | number | null = null;

    while (found < limit) {
      const response = await qdrant.scroll(collectionName, {
        limit: 100,
        offset,
        with_payload: true,
        with_vector: false,
      });

      for (const point of response.points) {
        const content = (point.payload?.content || '') as string;
        if (content.toLowerCase().includes(query.toLowerCase())) {
          found++;
          console.log(`${found}. ID: ${point.id}`);
          console.log(`   PersonaId: ${point.payload?.personaId || 'N/A'}`);
          console.log(`   PersonalityId: ${point.payload?.personalityId || 'N/A'}`);
          const excerpt = content.substring(0, 200).replace(/\n/g, ' ');
          console.log(`   Content: ${excerpt}${content.length > 200 ? '...' : ''}`);
          console.log('');

          if (found >= limit) break;
        }
      }

      offset = response.next_page_offset;
      if (!offset) break;
    }

    if (found === 0) {
      console.log('  No matches found');
    }

  } catch (error) {
    console.error(`❌ Collection "${collectionName}" not found or search failed`);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Delete specific points by filters
 */
async function deletePoints(options: {
  collection: string;
  personalityId?: string;
  startTime?: string;
  endTime?: string;
  dryRun: boolean;
}) {
  const { collection, personalityId, startTime, endTime, dryRun } = options;

  console.log(`\n🗑️  Delete Points from ${collection}`);
  console.log('═'.repeat(80));

  if (personalityId) console.log(`  Personality: ${personalityId}`);
  if (startTime) console.log(`  Time range: ${startTime} to ${endTime}`);
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'LIVE DELETION'}`);
  console.log('');

  try {
    // Build filter
    const must: any[] = [];

    if (personalityId) {
      must.push({
        key: 'personalityId',
        match: { value: personalityId }
      });
    }

    if (startTime && endTime) {
      const startTimestamp = new Date(startTime).getTime();
      const endTimestamp = new Date(endTime).getTime();
      must.push({
        key: 'createdAt',
        range: {
          gte: startTimestamp,
          lte: endTimestamp
        }
      });
    }

    if (must.length === 0) {
      console.error('❌ Must provide at least one filter (personalityId or time range)');
      process.exit(1);
    }

    // Search for matching points
    const scrollResult = await qdrant.scroll(collection, {
      filter: { must },
      limit: 100,
      with_payload: true,
      with_vector: false
    });

    const points = scrollResult.points;

    if (points.length === 0) {
      console.log('✨ No matching points found');
      return;
    }

    console.log(`Found ${points.length} points:\n`);

    // Display points
    for (const point of points) {
      const payload = point.payload as any;
      console.log(`  ID: ${point.id}`);
      if (payload.createdAt) {
        console.log(`    Timestamp: ${new Date(payload.createdAt).toISOString()}`);
      }
      if (payload.personalityId) {
        console.log(`    Personality: ${payload.personalityId}`);
      }
      if (payload.content) {
        const preview = payload.content.substring(0, 150).replace(/\n/g, ' ');
        console.log(`    Content: ${preview}${payload.content.length > 150 ? '...' : ''}`);
      }
      console.log('');
    }

    if (dryRun) {
      console.log('🔍 [DRY RUN] Would delete these points. Run without --dry-run to actually delete.');
      return;
    }

    // Actually delete
    const pointIds = points.map(p => p.id);
    console.log(`⚠️  Deleting ${pointIds.length} points...`);

    await qdrant.delete(collection, {
      points: pointIds
    });

    console.log('✅ Points deleted successfully\n');

  } catch (error) {
    console.error('❌ Failed to delete points:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Show statistics for a collection
 */
async function showStats(collectionName: string) {
  try {
    const collection = await qdrant.getCollection(collectionName);

    console.log(`\n📊 Statistics for ${collectionName}\n`);
    console.log('═'.repeat(80));

    console.log(`Total points: ${collection.points_count}`);
    console.log(`Indexed vectors: ${collection.indexed_vectors_count}`);
    console.log(`Segments: ${collection.segments_count}`);

    // Sample some points to analyze payload structure
    const sample = await qdrant.scroll(collectionName, {
      limit: 100,
      with_payload: true,
      with_vector: false
    });

    if (sample.points.length > 0) {
      // Analyze personalities
      const personalities = new Map<string, number>();
      const timeRange = { earliest: Infinity, latest: 0 };

      for (const point of sample.points) {
        const payload = point.payload as any;

        if (payload.personalityId) {
          personalities.set(
            payload.personalityId,
            (personalities.get(payload.personalityId) || 0) + 1
          );
        }

        if (payload.createdAt) {
          timeRange.earliest = Math.min(timeRange.earliest, payload.createdAt);
          timeRange.latest = Math.max(timeRange.latest, payload.createdAt);
        }
      }

      console.log('\n' + '═'.repeat(80));
      console.log('SAMPLE ANALYSIS (from first 100 points):');
      console.log('═'.repeat(80));

      if (personalities.size > 0) {
        console.log('\nPersonalities:');
        Array.from(personalities.entries())
          .sort((a, b) => b[1] - a[1])
          .forEach(([id, count]) => {
            console.log(`  ${id}: ${count} points`);
          });
      }

      if (timeRange.earliest !== Infinity) {
        console.log('\nTime range:');
        console.log(`  Earliest: ${new Date(timeRange.earliest).toISOString()}`);
        console.log(`  Latest: ${new Date(timeRange.latest).toISOString()}`);
      }
    }

    console.log('\n');

  } catch (error) {
    console.error(`❌ Collection "${collectionName}" not found`);
    process.exit(1);
  }
}

/**
 * Clean up empty collections
 */
async function vacuum(dryRun: boolean = false) {
  console.log(`\n🧹 Vacuum: ${dryRun ? 'Finding' : 'Removing'} empty collections\n`);
  console.log('═'.repeat(80));

  const response = await qdrant.getCollections();

  const emptyCollections: string[] = [];

  for (const collection of response.collections) {
    try {
      const detail = await qdrant.getCollection(collection.name);
      if (detail.points_count === 0) {
        emptyCollections.push(collection.name);
      }
    } catch (error) {
      // Skip if can't access
    }
  }

  if (emptyCollections.length === 0) {
    console.log('✨ No empty collections found\n');
    return;
  }

  console.log(`Found ${emptyCollections.length} empty collections:\n`);
  emptyCollections.forEach(name => console.log(`  - ${name}`));
  console.log('');

  if (dryRun) {
    console.log('🔍 [DRY RUN] Run without --dry-run to delete these collections\n');
    return;
  }

  console.log('⚠️  Deleting empty collections...');

  for (const name of emptyCollections) {
    try {
      await qdrant.deleteCollection(name);
      console.log(`  ✅ Deleted ${name}`);
    } catch (error) {
      console.log(`  ❌ Failed to delete ${name}`);
    }
  }

  console.log('\n✅ Vacuum complete\n');
}

/**
 * Main CLI entry point
 */
async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    console.log(`
Qdrant CLI - Comprehensive tool for managing Qdrant vector memories

Usage:
  pnpm qdrant <command> [args]

COLLECTION COMMANDS:
  list                                 List all collections with grouping
  inspect <collection>                 Show detailed collection info
  count <collection>                   Count points in collection
  sample <collection> [limit]          Show sample points (default: 5)
  stats <collection>                   Show collection statistics
  delete <collection> --force          Delete entire collection (requires --force)
  vacuum [--dry-run]                   Remove empty collections

POINT COMMANDS:
  search <collection> <query> [limit]  Search points by text (default: 10)
  delete-points <collection> [options] Delete specific points by filters
    --personality-id <uuid>            Filter by personality
    --start-time <ISO timestamp>       Filter by start time
    --end-time <ISO timestamp>         Filter by end time
    --dry-run                          Preview deletions without executing

Examples:
  # Collection management
  pnpm qdrant list
  pnpm qdrant inspect persona-3bd86394-20d8-5992-8201-e621856e9087
  pnpm qdrant stats persona-3bd86394-20d8-5992-8201-e621856e9087
  pnpm qdrant vacuum --dry-run

  # Point operations
  pnpm qdrant search persona-782be8b4-9fd9-5005-9358-5605f63ead99 "coding"
  pnpm qdrant delete-points persona-782be8b4-9fd9-5005-9358-5605f63ead99 \\
    --personality-id c296b337-4e67-5337-99a3-4ca105cbbd68 \\
    --start-time "2025-10-27T05:00:00Z" \\
    --end-time "2025-10-27T06:00:00Z" \\
    --dry-run

  # Dangerous operations (require --force)
  pnpm qdrant delete personality-c296b337-4e67-5337-99a3-4ca105cbbd68 --force
    `);
    process.exit(0);
  }

  try {
    switch (command) {
      case 'list':
        await listCollections();
        break;

      case 'inspect':
        if (!args[0]) {
          console.error('❌ Missing collection name');
          console.error('Usage: pnpm qdrant inspect <collection>');
          process.exit(1);
        }
        await inspectCollection(args[0]);
        break;

      case 'count':
        if (!args[0]) {
          console.error('❌ Missing collection name');
          console.error('Usage: pnpm qdrant count <collection>');
          process.exit(1);
        }
        await countPoints(args[0]);
        break;

      case 'stats':
        if (!args[0]) {
          console.error('❌ Missing collection name');
          console.error('Usage: pnpm qdrant stats <collection>');
          process.exit(1);
        }
        await showStats(args[0]);
        break;

      case 'sample':
        if (!args[0]) {
          console.error('❌ Missing collection name');
          console.error('Usage: pnpm qdrant sample <collection> [limit]');
          process.exit(1);
        }
        await samplePoints(args[0], args[1] ? parseInt(args[1]) : 5);
        break;

      case 'search':
        if (!args[0] || !args[1]) {
          console.error('❌ Missing collection name or query');
          console.error('Usage: pnpm qdrant search <collection> <query> [limit]');
          process.exit(1);
        }
        await searchCollection(args[0], args[1], args[2] ? parseInt(args[2]) : 10);
        break;

      case 'delete-points': {
        if (!args[0]) {
          console.error('❌ Missing collection name');
          console.error('Usage: pnpm qdrant delete-points <collection> [options]');
          process.exit(1);
        }

        // Parse options
        const getOption = (flag: string) => {
          const index = args.indexOf(flag);
          return index !== -1 ? args[index + 1] : undefined;
        };

        await deletePoints({
          collection: args[0],
          personalityId: getOption('--personality-id'),
          startTime: getOption('--start-time'),
          endTime: getOption('--end-time'),
          dryRun: args.includes('--dry-run')
        });
        break;
      }

      case 'vacuum':
        await vacuum(args.includes('--dry-run'));
        break;

      case 'delete':
        if (!args[0]) {
          console.error('❌ Missing collection name');
          console.error('Usage: pnpm qdrant delete <collection> --force');
          process.exit(1);
        }
        await deleteCollection(args[0], args.includes('--force'));
        break;

      default:
        console.error(`❌ Unknown command: ${command}`);
        console.error('Run "pnpm qdrant --help" for usage');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
