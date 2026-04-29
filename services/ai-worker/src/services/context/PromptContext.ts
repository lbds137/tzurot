/**
 * Memory document structure (from pgvector).
 *
 * The only currently-active type from this file. The previous `PromptContext`
 * and `TokenBudget` interfaces (a refactor leftover) had no production
 * consumers and were removed when knip enforcement landed.
 */
export interface MemoryDocument {
  pageContent: string;
  metadata?: {
    id?: string;
    createdAt?: string | number;
    score?: number;
    [key: string]: unknown;
  };
}
