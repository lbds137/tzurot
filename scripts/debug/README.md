# Debugging Scripts

Scripts for debugging database state, conversation ordering, and system behavior.

## Scripts

- **check-db-state.cjs** - Check PostgreSQL database connection and basic state
- **check-conversation-ordering.ts** - Verify conversation history ordering and timestamps

## Usage

```bash
# Check database state
node scripts/debug/check-db-state.cjs

# Verify conversation ordering
npx tsx scripts/debug/check-conversation-ordering.ts
```

**⚠️ See:** `tzurot-observability` skill for Railway log analysis and production debugging
