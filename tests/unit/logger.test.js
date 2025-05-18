// Tests for logger.js

// Mock fs and path modules first
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn()
}));

jest.mock('path', () => ({
  join: jest.fn()
}));

// Mock Winston before importing the logger module
jest.mock('winston', () => {
  // Create the mock logger functions
  const mockLoggerFunctions = {
    info: jest.fn(),
    warn: jest.fn(), 
    error: jest.fn(),
    debug: jest.fn()
  };
  
  // Create the mock logger object that createLogger will return
  const mockLoggerInstance = mockLoggerFunctions;
  
  // Create mock format functions
  const mockFormat = {
    combine: jest.fn().mockReturnValue('mockCombinedFormat'),
    timestamp: jest.fn().mockReturnValue('mockTimestampFormat'),
    printf: jest.fn().mockReturnValue('mockPrintfFormat'),
    colorize: jest.fn().mockReturnValue('mockColorizeFormat')
  };
  
  // Mock the Console and File transports
  const MockConsoleTransport = jest.fn().mockImplementation(() => ({ 
    name: 'MockConsoleTransport' 
  }));
  
  const MockFileTransport = jest.fn().mockImplementation((config) => ({ 
    name: 'MockFileTransport',
    filename: config.filename,
    level: config.level,
    maxsize: config.maxsize,
    maxFiles: config.maxFiles
  }));
  
  return {
    createLogger: jest.fn().mockReturnValue(mockLoggerInstance),
    format: mockFormat,
    transports: {
      Console: MockConsoleTransport,
      File: MockFileTransport
    },
    // Export the mock functions for testing
    mockLoggerFunctions
  };
});

// Import the mocked modules
const fs = require('fs');
const path = require('path');
const winston = require('winston');

describe('Logger module', () => {
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Default mock implementations
    path.join.mockImplementation((...parts) => parts.join('/'));
    fs.existsSync.mockReturnValue(false);
  });
  
  test('creates logs directory if it does not exist', () => {
    // Configure mocks
    path.join.mockReturnValue('/path/to/logs');
    fs.existsSync.mockReturnValue(false);
    
    // Import the logger module (this will execute the initialization code)
    jest.isolateModules(() => {
      require('../../src/logger');
    });
    
    // The logger should check if the directory exists
    expect(fs.existsSync).toHaveBeenCalledWith('/path/to/logs');
    
    // And then create it since it doesn't exist
    expect(fs.mkdirSync).toHaveBeenCalledWith('/path/to/logs');
  });
  
  test('does not create logs directory if it already exists', () => {
    // Configure mocks
    path.join.mockReturnValue('/path/to/logs');
    fs.existsSync.mockReturnValue(true);
    
    // Import the logger module (this will execute the initialization code)
    jest.isolateModules(() => {
      require('../../src/logger');
    });
    
    // The logger should check if the directory exists
    expect(fs.existsSync).toHaveBeenCalledWith('/path/to/logs');
    
    // But should not create it since it already exists
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });
  
  test('creates winston logger with correct configuration', () => {
    // Setup path.join to return specific values for each call
    path.join
      .mockReturnValueOnce('/path/to/logs') // For logs directory
      .mockReturnValueOnce('/path/to/logs/tzurot.log') // For general log file
      .mockReturnValueOnce('/path/to/logs/error.log'); // For error log file
    
    // Import the logger module
    jest.isolateModules(() => {
      require('../../src/logger');
    });
    
    // Winston's createLogger should be called once
    expect(winston.createLogger).toHaveBeenCalledTimes(1);
    
    // Check the configuration passed to createLogger
    const loggerConfig = winston.createLogger.mock.calls[0][0];
    expect(loggerConfig.level).toBe('info');
    expect(loggerConfig.format).toBe('mockCombinedFormat');
    
    // Verify transports configuration
    expect(loggerConfig.transports).toHaveLength(3);
    
    // Check formatting functions were called
    expect(winston.format.timestamp).toHaveBeenCalledWith({ 
      format: 'YYYY-MM-DD HH:mm:ss' 
    });
    expect(winston.format.printf).toHaveBeenCalled();
    expect(winston.format.combine).toHaveBeenCalled();
    expect(winston.format.colorize).toHaveBeenCalled();
  });
  
  test('configures Console transport with correct formatting', () => {
    // Setup mock
    path.join.mockReturnValue('/path/to/logs');
    
    // Import the logger module
    jest.isolateModules(() => {
      require('../../src/logger');
    });
    
    // Console transport should be created once
    expect(winston.transports.Console).toHaveBeenCalledTimes(1);
    
    // Check console transport config
    const consoleConfig = winston.transports.Console.mock.calls[0][0];
    expect(consoleConfig.format).toBe('mockCombinedFormat');
  });
  
  test('configures File transports with correct paths and settings', () => {
    // Setup path.join to return specific values for each call
    path.join
      .mockReturnValueOnce('/path/to/logs') // For logs directory
      .mockReturnValueOnce('/path/to/logs/tzurot.log') // For general log file
      .mockReturnValueOnce('/path/to/logs/error.log'); // For error log file
    
    // Import the logger module
    jest.isolateModules(() => {
      require('../../src/logger');
    });
    
    // File transport should be created twice (general log and error log)
    expect(winston.transports.File).toHaveBeenCalledTimes(2);
    
    // Check general log file config
    const generalLogConfig = winston.transports.File.mock.calls[0][0];
    expect(generalLogConfig.filename).toBe('/path/to/logs/tzurot.log');
    expect(generalLogConfig.maxsize).toBe(5242880); // 5MB
    expect(generalLogConfig.maxFiles).toBe(5);
    
    // Check error log file config
    const errorLogConfig = winston.transports.File.mock.calls[1][0];
    expect(errorLogConfig.filename).toBe('/path/to/logs/error.log');
    expect(errorLogConfig.level).toBe('error');
    expect(errorLogConfig.maxsize).toBe(5242880); // 5MB
    expect(errorLogConfig.maxFiles).toBe(5);
  });
  
  test('exports a logger object', () => {
    // Import the logger module
    const logger = require('../../src/logger');
    
    // Verify the logger is defined
    expect(logger).toBeDefined();
  });
});