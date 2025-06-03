/**
 * Tests for dataStorage.js
 */

// Mock logger and config first
jest.mock('../../src/logger');
jest.mock('../../config', () => ({
  botPrefix: '!tz',
  botConfig: {
    isDevelopment: false,
    mentionChar: '@'
  }
}));

// Mock fs module
jest.mock('fs', () => {
  // Create a virtual filesystem
  const virtualFs = {
    files: new Map(),
    dirs: new Set(['/']),
    
    // Mock promises API
    promises: {
      mkdir: jest.fn().mockImplementation((dir, options) => {
        virtualFs.dirs.add(dir);
        return Promise.resolve();
      }),
      
      writeFile: jest.fn().mockImplementation((filepath, data) => {
        virtualFs.files.set(filepath, data);
        return Promise.resolve();
      }),
      
      readFile: jest.fn().mockImplementation((filepath, encoding) => {
        if (virtualFs.files.has(filepath)) {
          return Promise.resolve(virtualFs.files.get(filepath));
        }
        // Simulate ENOENT error for files that don't exist
        const error = new Error(`ENOENT: no such file or directory, open '${filepath}'`);
        error.code = 'ENOENT';
        return Promise.reject(error);
      })
    }
  };
  
  return virtualFs;
});

// Mock path module
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/'))
}));

// Import the module to test after mocking dependencies
const dataStorage = require('../../src/dataStorage');

describe('dataStorage', () => {
  // Original console methods
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  
  beforeEach(() => {
    // Mock console methods to prevent noisy output
    console.log = jest.fn();
    console.error = jest.fn();
    
    // Reset mocks between tests
    jest.clearAllMocks();
    
    // Reset the virtual filesystem
    const fs = require('fs');
    fs.files.clear();
    fs.dirs = new Set(['/']);
  });
  
  afterEach(() => {
    // Restore console methods
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });
  
  describe('initStorage', () => {
    it('should create the data directory if it does not exist', async () => {
      const fs = require('fs');
      
      // Call initStorage
      await dataStorage.initStorage();
      
      // Verify mkdir was called
      expect(fs.promises.mkdir).toHaveBeenCalled();
      // Path will have the full path with the process.cwd included, so just check it contains the right part
      expect(fs.promises.mkdir.mock.calls[0][0]).toContain('data');
      expect(fs.promises.mkdir.mock.calls[0][1]).toEqual({ recursive: true });
      
      // Verify a directory was created in our virtual filesystem
      const dataDir = Array.from(fs.dirs).find(dir => dir.includes('data'));
      expect(dataDir).toBeDefined();
    });
    
    it('should handle errors during initialization', async () => {
      const fs = require('fs');
      
      // Mock logger.error
      const logger = require('../../src/logger');
      const originalLoggerError = logger.error;
      logger.error = jest.fn();
      
      // Mock mkdir to throw an error
      const error = new Error('Test error');
      fs.promises.mkdir.mockRejectedValueOnce(error);
      
      // Call initStorage and expect it to throw
      await expect(dataStorage.initStorage()).rejects.toThrow(error);
      
      // Verify error was logged using the structured logger
      expect(logger.error).toHaveBeenCalled();
      
      // Restore logger.error
      logger.error = originalLoggerError;
    });
  });
  
  describe('saveData', () => {
    it('should save data to a file', async () => {
      const fs = require('fs');
      const testData = { test: 'data', nested: { value: 42 } };
      
      // Call saveData
      await dataStorage.saveData('testfile', testData);
      
      // Verify writeFile was called
      expect(fs.promises.writeFile).toHaveBeenCalled();
      // Path will have the full path with the process.cwd included, so just check it contains the right part
      expect(fs.promises.writeFile.mock.calls[0][0]).toContain('data/testfile.json');
      
      // Verify the data was formatted correctly (JSON with indentation)
      const savedData = fs.promises.writeFile.mock.calls[0][1];
      expect(savedData).toBe(JSON.stringify(testData, null, 2));
      
      // Verify a file was created in our virtual filesystem
      const testFile = Array.from(fs.files.keys()).find(path => path.includes('testfile.json'));
      expect(testFile).toBeDefined();
    });
    
    it('should handle errors during save', async () => {
      const fs = require('fs');
      
      // Mock logger.error
      const logger = require('../../src/logger');
      const originalLoggerError = logger.error;
      logger.error = jest.fn();
      
      // Mock writeFile to throw an error
      const error = new Error('Test error');
      fs.promises.writeFile.mockRejectedValueOnce(error);
      
      // Call saveData and expect it to throw
      await expect(dataStorage.saveData('testfile', { test: 'data' })).rejects.toThrow(error);
      
      // Verify error was logged
      expect(logger.error).toHaveBeenCalled();
      
      // Restore logger.error
      logger.error = originalLoggerError;
    });
  });
  
  describe('loadData', () => {
    it('should load data from a file', async () => {
      const fs = require('fs');
      const testData = { test: 'data', nested: { value: 42 } };
      
      // Set up a file in our virtual filesystem - need to use the full path that will be used
      const filePath = `${process.cwd()}/src/../data/testfile.json`;
      fs.files.set(filePath, JSON.stringify(testData));
      
      // Call loadData
      const loadedData = await dataStorage.loadData('testfile');
      
      // Verify readFile was called
      expect(fs.promises.readFile).toHaveBeenCalled();
      // Path will have the full path with the process.cwd included, so just check it contains the right part
      expect(fs.promises.readFile.mock.calls[0][0]).toContain('data/testfile.json');
      expect(fs.promises.readFile.mock.calls[0][1]).toBe('utf8');
      
      // Verify the data was loaded correctly
      expect(loadedData).toEqual(testData);
    });
    
    it('should return null for files that do not exist', async () => {
      // Call loadData for a file that doesn't exist in our virtual filesystem
      const loadedData = await dataStorage.loadData('nonexistent');
      
      // Verify null was returned
      expect(loadedData).toBeNull();
      
      // No need to check error logging for expected case with structured logger
    });
    
    it('should handle parse errors', async () => {
      const fs = require('fs');
      
      // Mock logger.error
      const logger = require('../../src/logger');
      const originalLoggerError = logger.error;
      logger.error = jest.fn();
      
      // Set up a file with invalid JSON in our virtual filesystem - need to use the full path
      const filePath = `${process.cwd()}/src/../data/invalid.json`;
      fs.files.set(filePath, '{ invalid: json }');
      
      // Call loadData and expect it to throw
      await expect(dataStorage.loadData('invalid')).rejects.toThrow();
      
      // Verify error was logged
      expect(logger.error).toHaveBeenCalled();
      
      // Restore logger.error
      logger.error = originalLoggerError;
    });
    
    it('should handle other file reading errors', async () => {
      const fs = require('fs');
      
      // Mock logger.error
      const logger = require('../../src/logger');
      const originalLoggerError = logger.error;
      logger.error = jest.fn();
      
      // Mock readFile to throw a non-ENOENT error
      const error = new Error('Test error');
      error.code = 'OTHER_ERROR';
      fs.promises.readFile.mockRejectedValueOnce(error);
      
      // Call loadData and expect it to throw
      await expect(dataStorage.loadData('testfile')).rejects.toThrow(error);
      
      // Verify error was logged
      expect(logger.error).toHaveBeenCalled();
      
      // Restore logger.error
      logger.error = originalLoggerError;
    });
  });
  
  describe('Integration Test', () => {
    it('should save and load data correctly', async () => {
      // Initialize storage
      await dataStorage.initStorage();
      
      // Save some test data
      const testData = { 
        name: 'test',
        values: [1, 2, 3],
        nested: { 
          key: 'value',
          boolean: true
        }
      };
      await dataStorage.saveData('integration', testData);
      
      // Load the data back
      const loadedData = await dataStorage.loadData('integration');
      
      // Verify the data matches what we saved
      expect(loadedData).toEqual(testData);
    });
  });
});