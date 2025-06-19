/**
 * File System Mocking Utilities for Testing
 * This file provides mock implementations of file system operations to facilitate testing.
 */

/**
 * Create a mock file system storage
 * Simulates file system operations for testing data persistence
 */
class MockFileSystem {
  constructor() {
    this.files = new Map();
    this.directories = new Set();

    // Initialize with default directories
    this.directories.add('/');
    this.directories.add('/data');
  }

  /**
   * Write data to a file
   * @param {string} filePath - Path to the file
   * @param {*} data - Data to write
   * @returns {Promise<boolean>} Success indicator
   */
  async writeFile(filePath, data) {
    // Ensure the directory exists
    const lastSlash = filePath.lastIndexOf('/');
    if (lastSlash > 0) {
      const dir = filePath.substring(0, lastSlash);
      await this.mkdir(dir);
    }

    // Store the data
    this.files.set(filePath, {
      content: data,
      mtime: new Date(),
    });

    return true;
  }

  /**
   * Read data from a file
   * @param {string} filePath - Path to the file
   * @returns {Promise<*>} File data
   */
  async readFile(filePath) {
    if (!this.files.has(filePath)) {
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
    }

    return this.files.get(filePath).content;
  }

  /**
   * Check if a file exists
   * @param {string} filePath - Path to the file
   * @returns {Promise<boolean>} Whether the file exists
   */
  async fileExists(filePath) {
    return this.files.has(filePath);
  }

  /**
   * Create a directory
   * @param {string} dirPath - Path to the directory
   * @returns {Promise<boolean>} Success indicator
   */
  async mkdir(dirPath) {
    // Split the path by slashes and create each directory in sequence
    const parts = dirPath.split('/').filter(p => p);
    let currentPath = '';

    for (const part of parts) {
      currentPath += '/' + part;
      this.directories.add(currentPath);
    }

    return true;
  }

  /**
   * Check if a directory exists
   * @param {string} dirPath - Path to the directory
   * @returns {Promise<boolean>} Whether the directory exists
   */
  async directoryExists(dirPath) {
    return this.directories.has(dirPath);
  }

  /**
   * List files in a directory
   * @param {string} dirPath - Path to the directory
   * @returns {Promise<string[]>} Array of file names
   */
  async readdir(dirPath) {
    if (!this.directories.has(dirPath)) {
      throw new Error(`ENOENT: no such file or directory, scandir '${dirPath}'`);
    }

    const filesInDir = Array.from(this.files.keys())
      .filter(filePath => {
        // Check if the file is directly in this directory
        const dir = filePath.substring(0, filePath.lastIndexOf('/'));
        return dir === dirPath;
      })
      .map(filePath => filePath.substring(filePath.lastIndexOf('/') + 1));

    return filesInDir;
  }

  /**
   * Delete a file
   * @param {string} filePath - Path to the file
   * @returns {Promise<boolean>} Success indicator
   */
  async unlink(filePath) {
    if (!this.files.has(filePath)) {
      throw new Error(`ENOENT: no such file or directory, unlink '${filePath}'`);
    }

    this.files.delete(filePath);
    return true;
  }

  /**
   * Get file stats
   * @param {string} filePath - Path to the file
   * @returns {Promise<Object>} File stats
   */
  async stat(filePath) {
    if (this.files.has(filePath)) {
      const fileData = this.files.get(filePath);
      return {
        isFile: () => true,
        isDirectory: () => false,
        mtime: fileData.mtime,
        size:
          typeof fileData.content === 'string'
            ? fileData.content.length
            : JSON.stringify(fileData.content).length,
      };
    }

    if (this.directories.has(filePath)) {
      return {
        isFile: () => false,
        isDirectory: () => true,
        mtime: new Date(),
        size: 0,
      };
    }

    throw new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
  }

  /**
   * Clear all files and reset to initial state
   */
  clear() {
    this.files.clear();
    this.directories.clear();
    this.directories.add('/');
    this.directories.add('/data');
  }
}

/**
 * Create a mock fs module
 * @param {MockFileSystem} mockFs - Optional existing mock file system
 * @returns {Object} Mock fs module
 */
function createMockFsModule(mockFs = new MockFileSystem()) {
  return {
    promises: {
      readFile: jest.fn().mockImplementation(async (path, options) => {
        try {
          const data = await mockFs.readFile(path);
          return typeof data === 'string' ? data : JSON.stringify(data);
        } catch (error) {
          throw error;
        }
      }),
      writeFile: jest.fn().mockImplementation(async (path, data, options) => {
        try {
          let content = data;
          if (typeof data !== 'string') {
            content = JSON.stringify(data);
          }
          return await mockFs.writeFile(path, content);
        } catch (error) {
          throw error;
        }
      }),
      mkdir: jest.fn().mockImplementation(async (path, options) => {
        try {
          return await mockFs.mkdir(path);
        } catch (error) {
          // If directory exists and the recursive option is provided, ignore the error
          if (error.code === 'EEXIST' && options?.recursive) {
            return undefined;
          }
          throw error;
        }
      }),
      readdir: jest.fn().mockImplementation(async (path, options) => {
        try {
          return await mockFs.readdir(path);
        } catch (error) {
          throw error;
        }
      }),
      unlink: jest.fn().mockImplementation(async path => {
        try {
          return await mockFs.unlink(path);
        } catch (error) {
          throw error;
        }
      }),
      stat: jest.fn().mockImplementation(async path => {
        try {
          return await mockFs.stat(path);
        } catch (error) {
          throw error;
        }
      }),
      access: jest.fn().mockImplementation(async (path, mode) => {
        try {
          if ((await mockFs.fileExists(path)) || (await mockFs.directoryExists(path))) {
            return undefined;
          }
          throw new Error(`ENOENT: no such file or directory, access '${path}'`);
        } catch (error) {
          throw error;
        }
      }),
    },
    // Also provide synchronous versions for compatibility
    readFileSync: jest.fn().mockImplementation((path, options) => {
      try {
        const data = mockFs.readFile(path);
        return typeof data === 'string' ? data : JSON.stringify(data);
      } catch (error) {
        throw error;
      }
    }),
    writeFileSync: jest.fn().mockImplementation((path, data, options) => {
      try {
        let content = data;
        if (typeof data !== 'string') {
          content = JSON.stringify(data);
        }
        return mockFs.writeFile(path, content);
      } catch (error) {
        throw error;
      }
    }),
    mkdirSync: jest.fn().mockImplementation((path, options) => {
      try {
        return mockFs.mkdir(path);
      } catch (error) {
        // If directory exists and the recursive option is provided, ignore the error
        if (error.code === 'EEXIST' && options?.recursive) {
          return undefined;
        }
        throw error;
      }
    }),
    readdirSync: jest.fn().mockImplementation((path, options) => {
      try {
        return mockFs.readdir(path);
      } catch (error) {
        throw error;
      }
    }),
    unlinkSync: jest.fn().mockImplementation(path => {
      try {
        return mockFs.unlink(path);
      } catch (error) {
        throw error;
      }
    }),
    statSync: jest.fn().mockImplementation(path => {
      try {
        return mockFs.stat(path);
      } catch (error) {
        throw error;
      }
    }),
    existsSync: jest.fn().mockImplementation(path => {
      try {
        return mockFs.fileExists(path) || mockFs.directoryExists(path);
      } catch (error) {
        return false;
      }
    }),
    // Provide the mock file system instance for direct manipulation in tests
    _mockFs: mockFs,
  };
}

module.exports = {
  MockFileSystem,
  createMockFsModule,
};
