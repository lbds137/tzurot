/**
 * Prisma 7.0 Configuration
 *
 * This file provides the database URL for Prisma migrations.
 * The PrismaClient uses driver adapters configured in common-types/src/services/prisma.ts
 *
 * Note: We use process.env instead of prisma's env() helper because env() throws
 * if the variable doesn't exist. This allows `prisma generate` to work without
 * DATABASE_URL (only migrations need it).
 */

import { defineConfig } from 'prisma/config';

export default defineConfig({
  earlyAccess: true,
  schema: 'prisma/schema.prisma',

  // Datasource configuration for migrations
  // Empty string fallback allows `prisma generate` to work without DATABASE_URL
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
