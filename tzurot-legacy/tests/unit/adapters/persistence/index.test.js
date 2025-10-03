/**
 * @jest-environment node
 *
 * Persistence Adapters Index Test
 * - Tests the exports from adapters/persistence/index.js
 */

const persistenceAdapters = require('../../../../src/adapters/persistence');
const {
  FilePersonalityRepository,
} = require('../../../../src/adapters/persistence/FilePersonalityRepository');
const {
  FileConversationRepository,
} = require('../../../../src/adapters/persistence/FileConversationRepository');
const {
  FileAuthenticationRepository,
} = require('../../../../src/adapters/persistence/FileAuthenticationRepository');
const {
  MemoryConversationRepository,
} = require('../../../../src/adapters/persistence/MemoryConversationRepository');

describe('Persistence Adapters Index', () => {
  it('should export FilePersonalityRepository', () => {
    expect(persistenceAdapters.FilePersonalityRepository).toBeDefined();
    expect(persistenceAdapters.FilePersonalityRepository).toBe(FilePersonalityRepository);
  });

  it('should export FileConversationRepository', () => {
    expect(persistenceAdapters.FileConversationRepository).toBeDefined();
    expect(persistenceAdapters.FileConversationRepository).toBe(FileConversationRepository);
  });

  it('should export FileAuthenticationRepository', () => {
    expect(persistenceAdapters.FileAuthenticationRepository).toBeDefined();
    expect(persistenceAdapters.FileAuthenticationRepository).toBe(FileAuthenticationRepository);
  });

  it('should export MemoryConversationRepository', () => {
    expect(persistenceAdapters.MemoryConversationRepository).toBeDefined();
    expect(persistenceAdapters.MemoryConversationRepository).toBe(MemoryConversationRepository);
  });

  it('should export exactly the expected modules', () => {
    const exportedKeys = Object.keys(persistenceAdapters).sort();
    expect(exportedKeys).toEqual([
      'FileAuthenticationRepository',
      'FileConversationRepository',
      'FilePersonalityRepository',
      'MemoryConversationRepository',
    ]);
  });
});
