# Qdrant Tooling - Critical Need for Proper Utilities

**Date**: 2025-10-24
**Status**: 🚨 URGENT - Currently using ad hoc Python scripts
**Priority**: High

## Problem

Currently, any interaction with Qdrant (debugging, data cleanup, inspection) requires writing one-off Python scripts. This is:

1. **Error-prone**: Each script re-implements the same connection logic, often incorrectly
2. **Inconsistent**: No standard way to query, no standard field names checked
3. **Wasteful**: Time spent writing throwaway scripts instead of using proper tools
4. **Dangerous**: Easy to query wrong collection, use wrong fields, or miss data

### Recent Example (2025-10-24)

While trying to clean up a duplicate memory entry, we wrote **4 separate throwaway scripts**:
- `show_recent_qdrant.py` - To see recent memories
- `delete_duplicate_memory.py` - Wrong timestamp logic
- `debug_qdrant_timestamps.py` - Wrong field names (looked for `text` instead of `content`)
- `cleanup_qdrant_by_timestamp.py` - Finally got it right

Each script had to:
- Re-implement Qdrant connection
- Re-discover the payload structure (`content` not `text`, `createdAt` not `timestamp`)
- Re-implement pagination logic
- Handle error cases independently

**This is unacceptable for production operations.**

## What We Need

### 1. CLI Tool for Common Operations

A proper CLI tool (e.g., `pnpm qdrant`) that supports:

```bash
# List collections
pnpm qdrant collections

# Show recent memories for a persona
pnpm qdrant recent --persona-id <uuid> --limit 20

# Search memories by text
pnpm qdrant search --persona-id <uuid> --query "text to find"

# Delete specific points
pnpm qdrant delete --collection <name> --point-id <uuid>

# Show collection stats
pnpm qdrant stats --persona-id <uuid>

# Verify sync between PostgreSQL and Qdrant
pnpm qdrant verify-sync --persona-id <uuid>
```

### 2. TypeScript Utilities Library

A shared utilities package that:

```typescript
// packages/qdrant-utils/src/index.ts
import { QdrantClient } from '@qdrant/js-client-rest';

export class QdrantDebugUtils {
  // List recent memories
  async getRecentMemories(personaId: string, limit: number): Promise<Memory[]>

  // Search by text content
  async searchByText(personaId: string, searchText: string): Promise<Memory[]>

  // Delete specific points
  async deletePoints(personaId: string, pointIds: string[]): Promise<void>

  // Get collection statistics
  async getCollectionStats(personaId: string): Promise<CollectionStats>

  // Verify all conversation_history entries have corresponding Qdrant points
  async verifySyncWithDatabase(personaId: string): Promise<SyncReport>
}
```

### 3. Admin Dashboard (Future)

Eventually, a web-based admin panel for:
- Viewing memories by persona/personality
- Searching and filtering
- Manual cleanup/deletion
- Sync verification
- Collection health monitoring

## Implementation Priority

### Phase 1 (Now): Basic CLI Tool
- [ ] Create `scripts/qdrant-cli.ts` with core commands
- [ ] Add `pnpm qdrant` script to root package.json
- [ ] Support: recent, search, delete, stats

### Phase 2 (Soon): Shared Utils Package
- [ ] Create `packages/qdrant-utils`
- [ ] Extract common patterns from QdrantMemoryService
- [ ] Use in both CLI and service code

### Phase 3 (Later): Admin Dashboard
- [ ] Web UI for memory inspection
- [ ] Integration with Railway deployment

## Acceptance Criteria

**We know this is done when:**
1. No more one-off Python scripts needed for Qdrant operations
2. Standard CLI commands for common debug tasks
3. TypeScript-based tools that use actual codebase types/interfaces
4. Documentation on how to use the tooling

## Related Issues

- Timestamp bug (fixed 2025-10-24): QdrantMemoryService was ignoring metadata timestamp
- Duplicate memory cleanup required 4 different scripts to get right
- No way to verify Qdrant/PostgreSQL sync without manual queries

## References

- `packages/common-types/src/services/QdrantMemoryService.ts` - Current service implementation
- `services/ai-worker/src/memory/QdrantMemoryAdapter.ts` - Adapter layer
- `/tmp/*.py` - All the throwaway scripts we had to write (examples of what NOT to do)
