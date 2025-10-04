/**
 * Compare memory formats between new and imported memories
 *
 * Shows the structural differences between:
 * - New memories (created by ConversationalRAGService)
 * - Imported memories (from shapes.inc)
 *
 * Usage:
 *   node scripts/compare-memory-formats.cjs [personality-id]
 */

const { QdrantClient } = require('@qdrant/js-client-rest');
const util = require('util');

const LILITH_ID = '1fed013b-053a-4bc8-bc09-7da5c44297d6';

async function main() {
  const personalityId = process.argv[2] || LILITH_ID;
  const collectionName = `personality-${personalityId}`;

  console.log(`\n📊 Comparing memory formats in: ${collectionName}\n`);

  // Initialize Qdrant client
  const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
  });

  try {
    // Fetch all memories and categorize by type
    let allMemories = [];
    let offset = null;

    while (true) {
      const batch = await qdrant.scroll(collectionName, {
        limit: 100,
        offset: offset,
        with_payload: true,
        with_vector: false,
      });

      allMemories.push(...batch.points);

      if (batch.next_page_offset === null || batch.next_page_offset === undefined) {
        break;
      }
      offset = batch.next_page_offset;
    }

    // Categorize memories
    const newMemories = allMemories.filter(m =>
      m.payload?.summaryType === 'conversation'
    );
    const importedMemories = allMemories.filter(m =>
      m.payload?.summaryType === 'automatic' || m.payload?.summaryType !== 'conversation'
    );

    console.log(`📈 Total memories: ${allMemories.length}`);
    console.log(`   New (conversation): ${newMemories.length}`);
    console.log(`   Imported (automatic): ${importedMemories.length}\n`);

    // Get one example of each
    const newExample = newMemories[0];
    const importedExample = importedMemories[0];

    if (!newExample || !importedExample) {
      console.log('⚠️  Not enough data to compare (need at least 1 of each type)\n');
      return;
    }

    // Show detailed comparison
    console.log('═'.repeat(80));
    console.log('NEW MEMORY FORMAT (created by ConversationalRAGService)');
    console.log('═'.repeat(80));
    console.log(`\nID: ${newExample.id}`);
    console.log(`ID Type: ${typeof newExample.id} (${isUUID(newExample.id) ? 'UUID' : 'not UUID'})`);
    console.log('\nPayload Structure:');
    printPayload(newExample.payload);

    console.log('\n' + '═'.repeat(80));
    console.log('IMPORTED MEMORY FORMAT (from shapes.inc)');
    console.log('═'.repeat(80));
    console.log(`\nID: ${importedExample.id}`);
    console.log(`ID Type: ${typeof importedExample.id} (${isUUID(importedExample.id) ? 'UUID' : 'not UUID'})`);
    console.log('\nPayload Structure:');
    printPayload(importedExample.payload);

    // Document differences
    console.log('\n' + '═'.repeat(80));
    console.log('DOCUMENTED DIFFERENCES');
    console.log('═'.repeat(80));

    const differences = [];

    // Compare fields
    const newFields = new Set(Object.keys(newExample.payload || {}));
    const importedFields = new Set(Object.keys(importedExample.payload || {}));

    const onlyInNew = [...newFields].filter(f => !importedFields.has(f));
    const onlyInImported = [...importedFields].filter(f => !newFields.has(f));
    const inBoth = [...newFields].filter(f => importedFields.has(f));

    if (onlyInNew.length > 0) {
      differences.push({
        category: 'Fields only in NEW memories',
        items: onlyInNew
      });
    }

    if (onlyInImported.length > 0) {
      differences.push({
        category: 'Fields only in IMPORTED memories',
        items: onlyInImported
      });
    }

    // Check type differences for shared fields
    const typeDiffs = [];
    for (const field of inBoth) {
      const newType = typeof newExample.payload[field];
      const importedType = typeof importedExample.payload[field];
      const newValue = newExample.payload[field];
      const importedValue = importedExample.payload[field];

      if (newType !== importedType) {
        typeDiffs.push(`${field}: NEW=${newType}, IMPORTED=${importedType}`);
      } else if (field === 'createdAt') {
        // Special check for timestamp format
        typeDiffs.push(`${field}: NEW=${newValue} (${new Date(newValue).toISOString()}), IMPORTED=${importedValue} (${new Date(importedValue).toISOString()})`);
      }
    }

    if (typeDiffs.length > 0) {
      differences.push({
        category: 'Type/Format differences for shared fields',
        items: typeDiffs
      });
    }

    // Print differences
    differences.forEach(diff => {
      console.log(`\n${diff.category}:`);
      diff.items.forEach(item => {
        console.log(`  - ${item}`);
      });
    });

    // Recommendations
    console.log('\n' + '═'.repeat(80));
    console.log('RECOMMENDATIONS FOR STANDARDIZATION');
    console.log('═'.repeat(80));
    console.log('\n1. Field Standardization:');
    if (onlyInImported.includes('metadata')) {
      console.log('   - Consider extracting useful data from imported "metadata" field');
    }
    console.log('   - Decide which fields are essential vs optional');
    console.log('   - Document schema for future imports\n');

    console.log('2. Type Consistency:');
    console.log('   - Ensure createdAt is always Unix milliseconds (integer)');
    console.log('   - Ensure IDs are always UUIDs\n');

    console.log('3. Content Format:');
    console.log('   - NEW: Stores "User (username): message\\nPersonality: response"');
    console.log('   - IMPORTED: Stores summary of conversation');
    console.log('   - Consider which format is more useful for RAG retrieval\n');

    console.log('4. summaryType values:');
    const summaryTypes = {};
    allMemories.forEach(m => {
      const type = m.payload?.summaryType || 'undefined';
      summaryTypes[type] = (summaryTypes[type] || 0) + 1;
    });
    console.log('   Current distribution:');
    Object.entries(summaryTypes).forEach(([type, count]) => {
      console.log(`   - ${type}: ${count}`);
    });
    console.log('');

  } catch (error) {
    if (error.status === 404) {
      console.error(`❌ Collection not found: ${collectionName}\n`);
    } else {
      console.error(`❌ Error:`, error.message);
      console.error(error);
    }
    process.exit(1);
  }
}

function printPayload(payload) {
  if (!payload) {
    console.log('  (no payload)');
    return;
  }

  const formatted = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'content') {
      // Truncate long content
      formatted[key] = typeof value === 'string'
        ? `"${value.substring(0, 100)}${value.length > 100 ? '...' : ''}"`
        : value;
    } else if (key === 'createdAt') {
      // Show both raw and formatted timestamp
      formatted[key] = `${value} (${new Date(value).toISOString()})`;
    } else if (typeof value === 'object' && value !== null) {
      // Show object structure
      formatted[key] = util.inspect(value, { depth: 2, colors: false });
    } else {
      formatted[key] = value;
    }
  }

  Object.entries(formatted).forEach(([key, value]) => {
    const typeInfo = typeof payload[key];
    console.log(`  ${key} (${typeInfo}): ${value}`);
  });
}

function isUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

main().catch(console.error);
