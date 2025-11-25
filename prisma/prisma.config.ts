/**
 * Prisma 7.0 Configuration
 *
 * This file provides the database URL for Prisma migrations.
 * The PrismaClient uses driver adapters configured in common-types/src/services/prisma.ts
 */

import path from 'node:path';
import type { PrismaConfig } from 'prisma';

const config: PrismaConfig = {
  earlyAccess: true,
  schema: path.join(__dirname, 'schema.prisma'),
};

export default config;
