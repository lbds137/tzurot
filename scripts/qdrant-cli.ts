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

  // Group by type
  const personality = response.collections.filter(c => c.name.startsWith('personality-'));
  const persona = response.collections.filter(c => c.name.startsWith('persona-') && !c.name.startsWith('persona-legacy-'));
  const legacy = response.collections.filter(c => c.name.startsWith('persona-legacy-'));
  const other = response.collections.filter(c =>
    !c.name.startsWith('personality-') &&
    !c.name.startsWith('persona-')
  );

  if (personality.length > 0) {
    console.log('🔮 Personality Collections (OLD FORMAT - personality-{uuid}):');
    personality.forEach(c => console.log(`  - ${c.name} (${c.points_count || 0} points)`));
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

  console.log(`Total: ${response.collections.length} collections, ${response.collections.reduce((sum, c) => sum + (c.points_count || 0), 0)} points`);
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
 * Main CLI entry point
 */
async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h') {
    console.log(`
Qdrant CLI - Reusable tool for inspecting Qdrant collections

Usage:
  pnpm qdrant <command> [args]

Commands:
  list                              List all collections
  inspect <collection>              Show collection details
  count <collection>                Count points in collection
  sample <collection> [limit]       Show sample points (default: 5)
  search <collection> <query> [limit]  Search collection by text (default: 10)

Examples:
  pnpm qdrant list
  pnpm qdrant inspect persona-3bd86394-20d8-5992-8201-e621856e9087
  pnpm qdrant count personality-c296b337-4e67-5337-99a3-4ca105cbbd68
  pnpm qdrant sample persona-legacy-98a94b95-cbd0-430b-8be2-602e1c75d8b0 3
  pnpm qdrant search personality-c296b337-4e67-5337-99a3-4ca105cbbd68 "coding"
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
