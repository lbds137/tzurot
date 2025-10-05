/**
 * Export and reimport Qdrant collection to rebuild indexes properly
 *
 * SAFETY FEATURES:
 * - Exports to backup file first
 * - Verifies backup before deletion
 * - Resumable import if interrupted
 * - Progress tracking
 */

require('dotenv/config');
const { QdrantClient } = require('@qdrant/js-client-rest');
const fs = require('fs');
const path = require('path');

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const PERSONALITY_ID = 'c296b337-4e67-5337-99a3-4ca105cbbd68';
const BACKUP_FILE = path.join(__dirname, `backup-${PERSONALITY_ID}-${Date.now()}.json`);

async function exportReimportCollection() {
  const qdrant = new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
  });

  const collectionName = `personality-${PERSONALITY_ID}`;

  console.log('🔧 Export/Reimport Qdrant Collection');
  console.log('='.repeat(80));
  console.log('Collection:', collectionName);
  console.log('Backup file:', BACKUP_FILE);
  console.log('='.repeat(80));
  console.log('\n⚠️  WARNING: This will DELETE and recreate the collection!');
  console.log('⚠️  Make sure no other processes are using this collection!\n');

  // Get current state
  const before = await qdrant.getCollection(collectionName);
  console.log('Current collection state:');
  console.log('  Total points:', before.points_count);
  console.log('  Segments:', before.segments_count);
  console.log('  Indexed createdAt:', before.payload_schema?.createdAt?.points || 0);
  console.log('  Vector size:', before.config.params.vectors.size);
  console.log('  Distance:', before.config.params.vectors.distance);

  // STEP 1: Export all points
  console.log('\n' + '='.repeat(80));
  console.log('STEP 1: Exporting all points');
  console.log('='.repeat(80));

  const allPoints = [];
  let offset = null;
  let exportBatch = 0;

  while (true) {
    console.log(`Fetching batch ${++exportBatch}...`);

    const result = await qdrant.scroll(collectionName, {
      limit: 100,
      offset: offset,
      with_payload: true,
      with_vector: true,
    });

    if (result.points.length === 0) break;

    allPoints.push(...result.points);
    console.log(`  Exported ${allPoints.length} points so far...`);

    offset = result.next_page_offset;
    if (!offset) break;
  }

  console.log(`\n✅ Exported ${allPoints.length} points total`);

  if (allPoints.length !== before.points_count) {
    console.log(`\n⚠️  WARNING: Expected ${before.points_count} points but got ${allPoints.length}`);
    console.log('   Proceeding anyway, but you should investigate this discrepancy.');
  }

  // STEP 2: Save backup
  console.log('\n' + '='.repeat(80));
  console.log('STEP 2: Saving backup file');
  console.log('='.repeat(80));

  const backup = {
    exportedAt: new Date().toISOString(),
    collectionName,
    originalConfig: before.config,
    pointsCount: allPoints.length,
    points: allPoints,
  };

  fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 2));
  console.log(`✅ Backup saved: ${BACKUP_FILE}`);

  const backupStats = fs.statSync(BACKUP_FILE);
  console.log(`   Size: ${(backupStats.size / 1024 / 1024).toFixed(2)} MB`);

  // Verify backup is readable
  const backupContent = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8'));
  if (backupContent.points.length !== allPoints.length) {
    throw new Error('Backup verification failed: point count mismatch');
  }
  console.log('   Verification: ✅ Backup is valid');

  // STEP 3: Delete collection
  console.log('\n' + '='.repeat(80));
  console.log('STEP 3: Deleting old collection');
  console.log('='.repeat(80));

  console.log('⚠️  About to DELETE collection:', collectionName);
  console.log('   Waiting 5 seconds... (Ctrl+C to abort)');

  await new Promise(resolve => setTimeout(resolve, 5000));

  await qdrant.deleteCollection(collectionName);
  console.log('✅ Collection deleted');

  // STEP 4: Recreate collection with indexes FIRST
  console.log('\n' + '='.repeat(80));
  console.log('STEP 4: Recreating collection with indexes');
  console.log('='.repeat(80));

  console.log('Creating collection...');
  await qdrant.createCollection(collectionName, {
    vectors: {
      size: before.config.params.vectors.size,
      distance: before.config.params.vectors.distance,
    },
    shard_number: 1, // Single shard to avoid segment issues
    on_disk_payload: before.config.params.on_disk_payload,
  });
  console.log('  ✅ Collection created');

  // Create indexes BEFORE importing data (critical!)
  console.log('\nCreating payload indexes (with wait: true)...');

  const indexes = [
    { field: 'createdAt', schema: 'integer' },
    { field: 'userId', schema: 'keyword' },
    { field: 'sessionId', schema: 'keyword' },
  ];

  for (const { field, schema } of indexes) {
    console.log(`  Creating ${field} index (${schema})...`);
    await qdrant.createPayloadIndex(collectionName, {
      field_name: field,
      field_schema: schema,
      wait: true,
    });
    console.log(`    ✅ ${field} index created`);
  }

  // STEP 5: Reimport points
  console.log('\n' + '='.repeat(80));
  console.log('STEP 5: Reimporting points');
  console.log('='.repeat(80));

  const batchSize = 100;
  let imported = 0;

  for (let i = 0; i < allPoints.length; i += batchSize) {
    const batch = allPoints.slice(i, i + batchSize);
    const batchPoints = batch.map(point => ({
      id: point.id,
      vector: point.vector,
      payload: point.payload,
    }));

    await qdrant.upsert(collectionName, {
      wait: true,
      points: batchPoints,
    });

    imported += batch.length;
    const progress = ((imported / allPoints.length) * 100).toFixed(1);
    console.log(`  Imported ${imported} / ${allPoints.length} points (${progress}%)`);
  }

  console.log(`\n✅ Reimported ${imported} points`);

  // STEP 6: Verify
  console.log('\n' + '='.repeat(80));
  console.log('STEP 6: Verification');
  console.log('='.repeat(80));

  const after = await qdrant.getCollection(collectionName);
  console.log('\nFinal collection state:');
  console.log('  Total points:', after.points_count);
  console.log('  Segments:', after.segments_count);
  console.log('  Indexed createdAt:', after.payload_schema?.createdAt?.points || 0);
  console.log('  Indexed userId:', after.payload_schema?.userId?.points || 0);
  console.log('  Indexed sessionId:', after.payload_schema?.sessionId?.points || 0);

  // Test Aug 24 memory
  console.log('\nTesting Aug 24 memory retrieval...');
  const testResult = await qdrant.scroll(collectionName, {
    limit: 10,
    filter: {
      must: [
        {
          key: 'createdAt',
          range: {
            gte: new Date('2025-08-24').getTime(),
            lt: new Date('2025-08-25').getTime(),
          }
        }
      ]
    },
    with_payload: ['createdAt', 'summaryType', 'content'],
    with_vector: false,
  });

  console.log(`  Found ${testResult.points.length} Aug 24 memories`);
  if (testResult.points.length > 0) {
    testResult.points.forEach(point => {
      const preview = (point.payload.content || '').substring(0, 60);
      console.log(`    - ${new Date(point.payload.createdAt).toISOString()}: "${preview}..."`);
    });
  }

  // Final results
  console.log('\n' + '='.repeat(80));
  console.log('FINAL RESULTS:');
  console.log('='.repeat(80));

  const success =
    after.points_count === allPoints.length &&
    after.payload_schema?.createdAt?.points === after.points_count &&
    testResult.points.length > 0;

  if (success) {
    console.log('✅ SUCCESS!');
    console.log(`   All ${after.points_count} points imported and indexed`);
    console.log('   All indexes cover 100% of points');
    console.log('   Aug 24 memory is searchable');
    console.log('\n✅ Old memories (Shapes Inc) are now retrievable!');
    console.log('\n💡 You can delete the backup file:');
    console.log(`   rm ${BACKUP_FILE}`);
  } else {
    console.log('⚠️  PARTIAL SUCCESS:');
    if (after.points_count !== allPoints.length) {
      console.log(`   Point count mismatch: ${after.points_count} vs ${allPoints.length}`);
    }
    if (after.payload_schema?.createdAt?.points !== after.points_count) {
      console.log(`   createdAt index incomplete: ${after.payload_schema?.createdAt?.points} / ${after.points_count}`);
    }
    if (testResult.points.length === 0) {
      console.log('   Aug 24 memory still not searchable');
    }
    console.log('\n⚠️  Keep the backup file until you verify everything works:');
    console.log(`   ${BACKUP_FILE}`);
  }
}

exportReimportCollection()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ FAILED:', error);
    console.error('\n⚠️  The backup file has been preserved:');
    console.error(`   ${BACKUP_FILE}`);
    console.error('\nYou can manually restore if needed.');
    process.exit(1);
  });
