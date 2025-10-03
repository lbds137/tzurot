/**
 * @jest-environment node
 *
 * AI Adapters Index Test
 * - Tests the exports from adapters/ai/index.js
 */

const aiAdapters = require('../../../../src/adapters/ai');
const { HttpAIServiceAdapter } = require('../../../../src/adapters/ai/HttpAIServiceAdapter');
const { AIServiceAdapterFactory } = require('../../../../src/adapters/ai/AIServiceAdapterFactory');

describe('AI Adapters Index', () => {
  it('should export HttpAIServiceAdapter', () => {
    expect(aiAdapters.HttpAIServiceAdapter).toBeDefined();
    expect(aiAdapters.HttpAIServiceAdapter).toBe(HttpAIServiceAdapter);
  });

  it('should export AIServiceAdapterFactory', () => {
    expect(aiAdapters.AIServiceAdapterFactory).toBeDefined();
    expect(aiAdapters.AIServiceAdapterFactory).toBe(AIServiceAdapterFactory);
  });

  it('should export exactly the expected modules', () => {
    const exportedKeys = Object.keys(aiAdapters).sort();
    expect(exportedKeys).toEqual(['AIServiceAdapterFactory', 'HttpAIServiceAdapter']);
  });
});
