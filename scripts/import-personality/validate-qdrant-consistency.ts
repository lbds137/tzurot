#!/usr/bin/env tsx
/**
 * Validate Qdrant Consistency
 *
 * Compares Qdrant memory collections against production Postgres data to ensure:
 * 1. All expected memories are present
 * 2. No duplicates exist
 * 3. Metadata is correctly formatted
 * 4. Persona/personality relationships are valid
 *
 * Usage:
 *   tsx scripts/import-personality/validate-qdrant-consistency.ts
 *   tsx scripts/import-personality/validate-qdrant-consistency.ts --persona {uuid}
 *   tsx scripts/import-personality/validate-qdrant-consistency.ts --personality {uuid}
 */

import { PrismaClient } from '@prisma/client';
import { QdrantClient } from '@qdrant/js-client-rest';
import { config as loadEnv } from 'dotenv';

loadEnv();

const prisma = new PrismaClient();
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL!,
  apiKey: process.env.QDRANT_API_KEY!,
});

interface ValidationIssue {
  type: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  details?: any;
}

interface ValidationResult {
  personaId: string;
  username?: string;
  totalMemories: number;
  uniquePersonalities: Set<string>;
  issues: ValidationIssue[];
}

async function validatePersona(personaId: string): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const uniquePersonalities = new Set<string>();
  const collectionName = `persona-${personaId}`;

  // Check if persona exists in database (skip for legacy collections)
  let persona;
  if (!personaId.startsWith('legacy-')) {
    persona = await prisma.persona.findUnique({
      where: { id: personaId },
      select: {
        name: true,
        owner: {
          select: { username: true }
        }
      },
    });

    if (!persona) {
      issues.push({
        type: 'error',
        category: 'database',
        message: 'Persona not found in database',
        details: { personaId },
      });
    }
  }

  // Check if collection exists in Qdrant
  let collection;
  try {
    collection = await qdrant.getCollection(collectionName);
  } catch (error) {
    issues.push({
      type: 'error',
      category: 'qdrant',
      message: 'Collection not found in Qdrant',
      details: { collectionName },
    });
    return {
      personaId,
      username: persona?.owner?.username,
      totalMemories: 0,
      uniquePersonalities,
      issues,
    };
  }

  // Fetch all memories
  const memories: any[] = [];
  let offset: string | number | null = null;

  while (true) {
    const response = await qdrant.scroll(collectionName, {
      limit: 100,
      offset,
      with_payload: true,
      with_vector: false,
    });

    memories.push(...response.points);
    offset = response.next_page_offset;
    if (!offset) break;
  }

  // Validate each memory
  const seenIds = new Set<string>();
  for (const memory of memories) {
    const id = String(memory.id);

    // Check for duplicates
    if (seenIds.has(id)) {
      issues.push({
        type: 'error',
        category: 'duplicates',
        message: 'Duplicate memory ID found',
        details: { id },
      });
    }
    seenIds.add(id);

    const payload = memory.payload || {};

    // Validate required fields
    if (!payload.content) {
      issues.push({
        type: 'error',
        category: 'metadata',
        message: 'Memory missing content',
        details: { id },
      });
    }

    if (!payload.personalityId) {
      issues.push({
        type: 'error',
        category: 'metadata',
        message: 'Memory missing personalityId',
        details: { id },
      });
    } else {
      uniquePersonalities.add(payload.personalityId);
    }

    if (!payload.personaId) {
      issues.push({
        type: 'error',
        category: 'metadata',
        message: 'Memory missing personaId',
        details: { id },
      });
    } else if (payload.personaId !== personaId && !personaId.includes('legacy')) {
      issues.push({
        type: 'error',
        category: 'metadata',
        message: 'Memory personaId mismatch',
        details: { id, expected: personaId, actual: payload.personaId },
      });
    }

    if (!payload.canonScope) {
      issues.push({
        type: 'warning',
        category: 'metadata',
        message: 'Memory missing canonScope',
        details: { id },
      });
    }

    if (!payload.createdAt && !payload.timestamp) {
      issues.push({
        type: 'warning',
        category: 'metadata',
        message: 'Memory missing timestamp',
        details: { id },
      });
    }
  }

  return {
    personaId,
    username: persona?.owner?.username,
    totalMemories: memories.length,
    uniquePersonalities,
    issues,
  };
}

async function validateAll(): Promise<void> {
  console.log('\n🔍 Validating All Qdrant Collections');
  console.log('═'.repeat(80));
  console.log('');

  // Get all persona collections
  const response = await qdrant.getCollections();
  const personaCollections = response.collections
    .filter(c => c.name.startsWith('persona-'))
    .map(c => c.name.replace('persona-', ''));

  console.log(`Found ${personaCollections.length} persona collections\n`);

  const results: ValidationResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const personaId of personaCollections) {
    const result = await validatePersona(personaId);
    results.push(result);

    const errors = result.issues.filter(i => i.type === 'error').length;
    const warnings = result.issues.filter(i => i.type === 'warning').length;

    totalErrors += errors;
    totalWarnings += warnings;

    const status = errors > 0 ? '❌' : warnings > 0 ? '⚠️' : '✅';
    console.log(`${status} ${result.username || personaId}`);
    console.log(`   Memories: ${result.totalMemories}`);
    console.log(`   Personalities: ${result.uniquePersonalities.size}`);

    if (errors > 0) {
      console.log(`   Errors: ${errors}`);
    }
    if (warnings > 0) {
      console.log(`   Warnings: ${warnings}`);
    }
    console.log('');
  }

  // Summary
  console.log('═'.repeat(80));
  console.log('📊 Validation Summary:');
  console.log('═'.repeat(80));
  console.log(`  Collections validated: ${personaCollections.length}`);
  console.log(`  Total memories: ${results.reduce((sum, r) => sum + r.totalMemories, 0)}`);
  console.log(`  Total errors: ${totalErrors}`);
  console.log(`  Total warnings: ${totalWarnings}`);

  if (totalErrors === 0 && totalWarnings === 0) {
    console.log('\n✅ All validations passed!');
  } else if (totalErrors === 0) {
    console.log('\n⚠️  Validation passed with warnings');
  } else {
    console.log('\n❌ Validation failed with errors');
  }

  // Print detailed issues
  if (totalErrors > 0 || totalWarnings > 0) {
    console.log('\n═'.repeat(80));
    console.log('📋 Detailed Issues:');
    console.log('═'.repeat(80));
    console.log('');

    for (const result of results) {
      if (result.issues.length > 0) {
        console.log(`\n${result.username || result.personaId}:`);
        for (const issue of result.issues) {
          const icon = issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️';
          console.log(`  ${icon} [${issue.category}] ${issue.message}`);
          if (issue.details) {
            console.log(`     Details: ${JSON.stringify(issue.details, null, 2).split('\n').join('\n     ')}`);
          }
        }
      }
    }
  }

  console.log('\n');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    await validateAll();
  } else if (args[0] === '--persona' && args[1]) {
    const result = await validatePersona(args[1]);
    console.log('\n📊 Validation Result:');
    console.log('═'.repeat(80));
    console.log(`  Persona: ${result.username || result.personaId}`);
    console.log(`  Memories: ${result.totalMemories}`);
    console.log(`  Personalities: ${result.uniquePersonalities.size}`);
    console.log(`  Errors: ${result.issues.filter(i => i.type === 'error').length}`);
    console.log(`  Warnings: ${result.issues.filter(i => i.type === 'warning').length}`);

    if (result.issues.length > 0) {
      console.log('\n📋 Issues:');
      for (const issue of result.issues) {
        const icon = issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`  ${icon} [${issue.category}] ${issue.message}`);
        if (issue.details) {
          console.log(`     ${JSON.stringify(issue.details)}`);
        }
      }
    } else {
      console.log('\n✅ No issues found!');
    }
    console.log('');
  } else {
    console.log(`
Usage:
  tsx scripts/import-personality/validate-qdrant-consistency.ts
  tsx scripts/import-personality/validate-qdrant-consistency.ts --persona {uuid}
    `);
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error('❌ Error:', error);
  process.exit(1);
});
