# Encryption Key Rotation Procedure

This document describes how to rotate the `API_KEY_ENCRYPTION_KEY` used for BYOK (Bring Your Own Key) API key encryption.

## Overview

User API keys are encrypted using AES-256-GCM with the master encryption key stored in `API_KEY_ENCRYPTION_KEY`. If this key is compromised or needs rotation for security compliance, follow this procedure.

## When to Rotate

- **Immediately**: If the encryption key is suspected to be compromised
- **Periodically**: As part of security compliance (e.g., annually)
- **Personnel changes**: When team members with key access leave
- **Security audit findings**: When recommended by security review

## Pre-Rotation Checklist

- [ ] Schedule maintenance window (users cannot update API keys during rotation)
- [ ] Generate new encryption key
- [ ] Backup current database
- [ ] Test rotation script in staging environment
- [ ] Notify affected users of maintenance window

## Key Generation

Generate a new 32-byte (256-bit) encryption key:

```bash
# Using OpenSSL (recommended)
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Output example**: `a1b2c3d4e5f6...` (64 hexadecimal characters)

## Rotation Procedure

### Step 1: Put Services in Maintenance Mode

```bash
# Scale down api-gateway to prevent new key operations
railway service scale api-gateway --replicas 0

# ai-worker can continue running (uses cached keys)
```

### Step 2: Run Key Rotation Script

```typescript
// scripts/rotate-encryption-key.ts
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// Get keys from environment
const OLD_KEY = Buffer.from(process.env.OLD_ENCRYPTION_KEY!, 'hex');
const NEW_KEY = Buffer.from(process.env.NEW_ENCRYPTION_KEY!, 'hex');

const prisma = new PrismaClient();

async function rotateKeys() {
  const keys = await prisma.userApiKey.findMany({
    select: { id: true, iv: true, content: true, tag: true },
  });

  console.log(`Found ${keys.length} keys to rotate`);

  for (const key of keys) {
    try {
      // Decrypt with old key
      const decipher = crypto.createDecipheriv(ALGORITHM, OLD_KEY, Buffer.from(key.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(key.tag, 'hex'));
      let plaintext = decipher.update(key.content, 'hex', 'utf8');
      plaintext += decipher.final('utf8');

      // Encrypt with new key
      const newIv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(ALGORITHM, NEW_KEY, newIv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const newTag = cipher.getAuthTag();

      // Update database
      await prisma.userApiKey.update({
        where: { id: key.id },
        data: {
          iv: newIv.toString('hex'),
          content: encrypted,
          tag: newTag.toString('hex'),
        },
      });

      console.log(`Rotated key ${key.id}`);
    } catch (error) {
      console.error(`Failed to rotate key ${key.id}:`, error);
      throw error; // Abort on any failure
    }
  }

  console.log('Key rotation complete');
}

rotateKeys()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

Run the script:

```bash
OLD_ENCRYPTION_KEY=<current-key> \
NEW_ENCRYPTION_KEY=<new-key> \
DATABASE_URL=<db-url> \
npx tsx scripts/rotate-encryption-key.ts
```

### Step 3: Update Environment Variables

```bash
# Update Railway environment variable
railway variables set API_KEY_ENCRYPTION_KEY=<new-key> --service api-gateway
railway variables set API_KEY_ENCRYPTION_KEY=<new-key> --service ai-worker
```

### Step 4: Restart Services

```bash
# Scale api-gateway back up
railway service scale api-gateway --replicas 1

# Restart ai-worker to clear cached keys
railway service restart ai-worker
```

### Step 5: Verify

```bash
# Check service health
curl https://api-gateway.up.railway.app/health

# Test key operations (as a test user)
# - List keys: should show existing keys
# - Set new key: should encrypt with new key
# - Use existing key: should decrypt and work
```

## Rollback Procedure

If rotation fails partway through:

1. **Stop the rotation script** immediately
2. **Do NOT update environment variables**
3. **Identify failed keys** from script output
4. **Restore from backup** if needed
5. **Investigate failure** before retrying

## Security Considerations

1. **Never store both keys** in the same location
2. **Delete old key** from all systems after successful rotation
3. **Audit log access** to encryption keys
4. **Document rotation** in security incident log
5. **Test decryption** with new key before deleting old key

## Emergency Key Compromise Response

If the encryption key is compromised:

1. **Immediately disable BYOK** by unsetting `API_KEY_ENCRYPTION_KEY`
2. **Notify affected users** that their API keys may be compromised
3. **Advise users to rotate** their provider API keys (OpenRouter, OpenAI, etc.)
4. **Generate new encryption key** and follow rotation procedure
5. **Users must re-enter** their API keys after rotation
6. **Conduct security review** to determine compromise scope

## Future Improvements

The current implementation uses a single encryption key. Future versions could support:

1. **Key versioning**: Store key version with encrypted data for seamless rotation
2. **Hardware Security Module (HSM)**: Use AWS KMS or similar for key management
3. **Automatic rotation**: Scheduled key rotation with zero-downtime migration
4. **Key escrow**: Secure backup of encryption keys for disaster recovery

## Related Documentation

- [BYOK Architecture](../architecture/BYOK_ARCHITECTURE.md)
- [Security Best Practices](../guides/SECURITY.md)
- [Railway Deployment](../deployment/RAILWAY_DEPLOYMENT.md)
