# Database Migration Plan for Tzurot

## Overview
This plan addresses the critical pain point of data loss during deployments, particularly:
- Authentication tokens being wiped (forcing users to re-authenticate)
- 66 personalities taking 9-10 minutes to reload due to API rate limits
- Aliases needing to be reconfigured

## Phase 1: Immediate Relief (1-2 days)

### Option A: Railway Persistent Volume
1. Configure Railway persistent volume at `/app/data`
2. No code changes required
3. Immediate fix for deployment data loss

### Option B: External Object Storage
1. Use Railway's object storage or AWS S3
2. Backup data before deployment
3. Restore after deployment
4. Add commands: `npm run backup` and `npm run restore`

## Phase 2: Database Abstraction Layer (3-4 days)

Create a clean abstraction that supports both JSON and database backends:

```javascript
// src/core/persistence/PersistenceAdapter.js
class PersistenceAdapter {
  async save(collection, key, data) { }
  async load(collection, key) { }
  async loadAll(collection) { }
  async delete(collection, key) { }
  async exists(collection, key) { }
}

// src/core/persistence/JsonAdapter.js
class JsonAdapter extends PersistenceAdapter {
  // Current JSON implementation
}

// src/core/persistence/PostgresAdapter.js
class PostgresAdapter extends PersistenceAdapter {
  // Future PostgreSQL implementation
}
```

## Phase 3: PostgreSQL Migration (1-2 weeks)

### Database Schema

```sql
-- Core tables for immediate pain points
CREATE TABLE personalities (
    full_name VARCHAR(255) PRIMARY KEY,
    display_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    added_by VARCHAR(50) NOT NULL,
    added_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE personality_aliases (
    alias VARCHAR(100) PRIMARY KEY,
    personality_name VARCHAR(255) NOT NULL REFERENCES personalities(full_name) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE auth_tokens (
    user_id VARCHAR(50) NOT NULL,
    personality_name VARCHAR(255) NOT NULL,
    token TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    last_used TIMESTAMPTZ,
    PRIMARY KEY (user_id, personality_name)
);

CREATE TABLE nsfw_verifications (
    user_id VARCHAR(50) PRIMARY KEY,
    verified_at TIMESTAMPTZ DEFAULT NOW(),
    verified_by VARCHAR(50)
);

-- Secondary tables (can migrate later)
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(50) NOT NULL,
    personality_name VARCHAR(255) NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_at TIMESTAMPTZ,
    message_count INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE channel_activations (
    channel_id VARCHAR(50) PRIMARY KEY,
    personality_name VARCHAR(255) NOT NULL REFERENCES personalities(full_name),
    activated_at TIMESTAMPTZ DEFAULT NOW(),
    activated_by VARCHAR(50)
);

-- Indexes for performance
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX idx_conversations_channel_personality ON conversations(channel_id, personality_name);
CREATE INDEX idx_personalities_added_by ON personalities(added_by);
```

### Migration Priority

1. **Week 1: Critical Data**
   - Auth tokens (prevents re-authentication)
   - Personalities & aliases (prevents 10-minute reload)
   - NSFW verifications

2. **Week 2: Secondary Data**
   - Conversations
   - Channel activations
   - Message mappings

### Implementation Steps

1. **Add Dependencies**
   ```json
   {
     "dependencies": {
       "pg": "^8.11.0",
       "pg-pool": "^3.6.0"
     },
     "devDependencies": {
       "node-pg-migrate": "^6.2.0"
     }
   }
   ```

2. **Create Database Service**
   ```javascript
   // src/core/persistence/DatabaseService.js
   const { Pool } = require('pg');
   
   class DatabaseService {
     constructor() {
       this.pool = new Pool({
         connectionString: process.env.DATABASE_URL,
         ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
       });
     }
     
     async query(text, params) {
       const result = await this.pool.query(text, params);
       return result.rows;
     }
     
     async transaction(callback) {
       const client = await this.pool.connect();
       try {
         await client.query('BEGIN');
         const result = await callback(client);
         await client.query('COMMIT');
         return result;
       } catch (error) {
         await client.query('ROLLBACK');
         throw error;
       } finally {
         client.release();
       }
     }
   }
   ```

3. **Migrate Personality Manager First**
   ```javascript
   // src/core/personality/PersonalityPersistence.js
   class PersonalityPersistence {
     constructor(adapter) {
       this.adapter = adapter; // Can be JsonAdapter or PostgresAdapter
     }
     
     async savePersonality(personality) {
       if (this.adapter instanceof PostgresAdapter) {
         await this.adapter.query(
           `INSERT INTO personalities (full_name, display_name, avatar_url, added_by, added_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (full_name) DO UPDATE
            SET display_name = $2, avatar_url = $3`,
           [personality.fullName, personality.displayName, personality.avatarUrl, 
            personality.addedBy, personality.addedAt]
         );
       } else {
         // Existing JSON logic
       }
     }
   }
   ```

## Phase 4: Advanced Features (Optional)

Once migrated, you can add:
- Connection pooling for better performance
- Read replicas for scaling
- Automated backups
- Query optimization
- Caching layer (Redis)

## Rollback Plan

1. Keep JSON adapters functional
2. Add feature flag: `USE_DATABASE=true/false`
3. Implement dual-write during transition
4. Keep JSON files as backup for 30 days post-migration

## Quick Win Implementation Order

1. **Day 1**: Set up Railway persistent volume (immediate fix)
2. **Week 1**: Create abstraction layer
3. **Week 2**: Migrate auth tokens and personalities to PostgreSQL
4. **Week 3**: Migrate remaining data
5. **Week 4**: Testing and optimization

## Benefits Summary

- **No more data loss on deployment**
- **Instant personality loading** (vs 10 minutes)
- **Auth tokens persist** across deployments
- **Better scalability** for future growth
- **Concurrent access** support
- **ACID transactions** for data consistency