/**
 * AI Adapter exports
 * @module adapters/ai
 */

const { HttpAIServiceAdapter } = require('./HttpAIServiceAdapter');
const { AIServiceAdapterFactory } = require('./AIServiceAdapterFactory');

module.exports = {
  HttpAIServiceAdapter,
  AIServiceAdapterFactory,
};
