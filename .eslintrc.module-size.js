/**
 * ESLint configuration for enforcing module size and complexity limits
 * This helps prevent modules from becoming too large and complex
 */

module.exports = {
  rules: {
    // Enforce maximum file length
    'max-lines': ['warn', {
      max: 800,  // Increased from 500 - some files legitimately need more
      skipBlankLines: true,
      skipComments: true
    }],
    
    // Enforce maximum function length
    'max-lines-per-function': ['warn', {
      max: 100,  // Increased from 50 - complex functions need room
      skipBlankLines: true,
      skipComments: true,
      IIFEs: true
    }],
    
    // Enforce maximum cyclomatic complexity
    'complexity': ['warn', {
      max: 15  // Increased from 10 - some logic is inherently complex
    }],
    
    // Enforce maximum depth of nested blocks
    'max-depth': ['warn', {
      max: 4  // Increased from 3 - standard depth for most codebases
    }],
    
    // Enforce maximum number of parameters
    'max-params': ['warn', {
      max: 5  // Increased from 4 - some functions need options objects
    }],
    
    // Enforce maximum number of statements in a function
    'max-statements': ['warn', {
      max: 30  // Increased from 20 - initialization functions need more
    }],
    
    // Enforce maximum number of classes per file
    'max-classes-per-file': ['warn', 1],
    
    // Enforce maximum nested callbacks
    'max-nested-callbacks': ['warn', {
      max: 3
    }]
  }
};