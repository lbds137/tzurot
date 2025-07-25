/**
 * ESLint configuration for enforcing module size and complexity limits
 * This helps prevent modules from becoming too large and complex
 */

module.exports = {
  rules: {
    // Enforce maximum file length
    'max-lines': ['warn', {
      max: 500,
      skipBlankLines: true,
      skipComments: true
    }],
    
    // Enforce maximum function length
    'max-lines-per-function': ['warn', {
      max: 50,
      skipBlankLines: true,
      skipComments: true,
      IIFEs: true
    }],
    
    // Enforce maximum cyclomatic complexity
    'complexity': ['warn', {
      max: 10
    }],
    
    // Enforce maximum depth of nested blocks
    'max-depth': ['warn', {
      max: 3
    }],
    
    // Enforce maximum number of parameters
    'max-params': ['warn', {
      max: 4
    }],
    
    // Enforce maximum number of statements in a function
    'max-statements': ['warn', {
      max: 20
    }],
    
    // Enforce maximum number of classes per file
    'max-classes-per-file': ['warn', 1],
    
    // Enforce maximum nested callbacks
    'max-nested-callbacks': ['warn', {
      max: 3
    }]
  }
};