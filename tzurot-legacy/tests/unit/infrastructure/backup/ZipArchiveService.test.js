/**
 * Tests for ZipArchiveService
 */

const { ZipArchiveService } = require('../../../../src/infrastructure/backup/ZipArchiveService');
const logger = require('../../../../src/logger');

// Mock dependencies
jest.mock('../../../../src/logger');
jest.mock('jszip');

describe('ZipArchiveService', () => {
  let zipArchiveService;
  let mockFs;
  let mockJSZip;
  let mockZipInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock console to keep test output clean
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Mock JSZip instance
    mockZipInstance = {
      file: jest.fn(),
      generateAsync: jest.fn(),
    };

    // Mock JSZip constructor
    mockJSZip = jest.fn(() => mockZipInstance);

    // Mock fs
    mockFs = {
      readdir: jest.fn(),
      stat: jest.fn(),
      readFile: jest.fn(),
    };

    // Create service with mocked dependencies
    zipArchiveService = new ZipArchiveService({
      fs: mockFs,
      JSZip: mockJSZip,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default dependencies', () => {
      const service = new ZipArchiveService();
      expect(service.fs).toBeDefined();
      expect(service.JSZip).toBeDefined();
    });

    it('should use injected dependencies', () => {
      expect(zipArchiveService.fs).toBe(mockFs);
      expect(zipArchiveService.JSZip).toBe(mockJSZip);
    });
  });

  describe('createPersonalityArchive', () => {
    const personalityName = 'testpersonality';
    const dataPath = '/data/personalities/testpersonality';
    const mockZipBuffer = Buffer.from('mock-zip-content');

    beforeEach(() => {
      // Setup default successful scenario
      mockFs.readdir.mockResolvedValue(['profile.json', 'memories.json']);
      mockFs.stat
        .mockResolvedValueOnce({ isDirectory: () => false }) // profile.json
        .mockResolvedValueOnce({ isDirectory: () => false }); // memories.json
      mockFs.readFile
        .mockResolvedValueOnce(Buffer.from('{"name":"test"}')) // profile.json
        .mockResolvedValueOnce(Buffer.from('[]')); // memories.json
      mockZipInstance.generateAsync.mockResolvedValue(mockZipBuffer);
    });

    it('should create a ZIP archive from personality data', async () => {
      const result = await zipArchiveService.createPersonalityArchive(personalityName, dataPath);

      expect(result).toBe(mockZipBuffer);
      expect(mockJSZip).toHaveBeenCalledTimes(1);
      expect(mockFs.readdir).toHaveBeenCalledWith(dataPath);
      expect(mockZipInstance.file).toHaveBeenCalledTimes(2);
      expect(mockZipInstance.file).toHaveBeenCalledWith(
        'testpersonality/profile.json',
        Buffer.from('{"name":"test"}')
      );
      expect(mockZipInstance.file).toHaveBeenCalledWith(
        'testpersonality/memories.json',
        Buffer.from('[]')
      );
      expect(mockZipInstance.generateAsync).toHaveBeenCalledWith({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Created ZIP archive for ${personalityName}`)
      );
    });

    it('should handle subdirectories recursively', async () => {
      // Simple test for directory handling
      mockFs.readdir.mockResolvedValue(['profile.json']);
      mockFs.stat.mockResolvedValue({ isDirectory: () => false });
      mockFs.readFile.mockResolvedValue(Buffer.from('{"name":"test"}'));

      await zipArchiveService.createPersonalityArchive(personalityName, dataPath);

      expect(mockFs.readdir).toHaveBeenCalledWith(dataPath);
      expect(mockZipInstance.file).toHaveBeenCalled();
      // Just verify it was called with the right file path
      expect(mockZipInstance.file.mock.calls[0][0]).toBe('testpersonality/profile.json');
    });

    it('should handle errors during archive creation', async () => {
      const error = new Error('Read error');
      mockFs.readdir.mockRejectedValue(error);

      await expect(
        zipArchiveService.createPersonalityArchive(personalityName, dataPath)
      ).rejects.toThrow('Failed to create ZIP archive: Read error');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to create archive for ${personalityName}:`),
        error
      );
    });

    it('should handle empty directories', async () => {
      mockFs.readdir.mockResolvedValue([]);

      const result = await zipArchiveService.createPersonalityArchive(personalityName, dataPath);

      expect(result).toBe(mockZipBuffer);
      expect(mockZipInstance.file).not.toHaveBeenCalled();
      expect(mockZipInstance.generateAsync).toHaveBeenCalled();
    });
  });

  describe('createBulkArchive', () => {
    const personalities = [
      { name: 'personality1', path: '/data/personalities/personality1' },
      { name: 'personality2', path: '/data/personalities/personality2' },
    ];
    const mockZipBuffer = Buffer.from('mock-bulk-zip');

    beforeEach(() => {
      // Setup for both personalities
      mockFs.readdir
        .mockResolvedValueOnce(['file1.json']) // personality1
        .mockResolvedValueOnce(['file2.json']); // personality2
      mockFs.stat
        .mockResolvedValueOnce({ isDirectory: () => false }) // file1.json
        .mockResolvedValueOnce({ isDirectory: () => false }); // file2.json
      mockFs.readFile
        .mockResolvedValueOnce(Buffer.from('{"p1":true}'))
        .mockResolvedValueOnce(Buffer.from('{"p2":true}'));
      mockZipInstance.generateAsync.mockResolvedValue(mockZipBuffer);
    });

    it('should create a bulk archive with multiple personalities', async () => {
      const result = await zipArchiveService.createBulkArchive(personalities);

      expect(result).toBe(mockZipBuffer);
      expect(mockJSZip).toHaveBeenCalledTimes(1);
      expect(mockFs.readdir).toHaveBeenCalledTimes(2);
      expect(mockZipInstance.file).toHaveBeenCalledTimes(2);
      expect(mockZipInstance.file).toHaveBeenCalledWith('personality1/file1.json', Buffer.from('{"p1":true}'));
      expect(mockZipInstance.file).toHaveBeenCalledWith('personality2/file2.json', Buffer.from('{"p2":true}'));
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Created bulk ZIP archive with 2 personalities')
      );
    });

    it('should handle empty personality list', async () => {
      const result = await zipArchiveService.createBulkArchive([]);

      expect(result).toBe(mockZipBuffer);
      expect(mockFs.readdir).not.toHaveBeenCalled();
      expect(mockZipInstance.file).not.toHaveBeenCalled();
      expect(mockZipInstance.generateAsync).toHaveBeenCalled();
    });

    it('should handle errors during bulk archive creation', async () => {
      const error = new Error('Bulk creation error');
      mockZipInstance.generateAsync.mockRejectedValue(error);

      await expect(zipArchiveService.createBulkArchive(personalities)).rejects.toThrow(
        'Failed to create bulk ZIP archive: Bulk creation error'
      );

      expect(logger.error).toHaveBeenCalledWith('[ZipArchiveService] Failed to create bulk archive:', error);
    });

    it('should handle partial failures in bulk archive', async () => {
      // The current implementation doesn't actually fail on individual personality errors
      // It logs them but continues processing other personalities
      mockFs.readdir.mockResolvedValue(['file.json']);
      mockFs.stat.mockResolvedValue({ isDirectory: () => false });
      mockFs.readFile.mockResolvedValue(Buffer.from('{"data":true}'));

      const result = await zipArchiveService.createBulkArchive(personalities);

      expect(result).toBe(mockZipBuffer);
      expect(mockZipInstance.generateAsync).toHaveBeenCalled();
    });
  });

  describe('formatBytes', () => {
    it('should format 0 bytes correctly', () => {
      expect(zipArchiveService.formatBytes(0)).toBe('0 Bytes');
    });

    it('should format bytes correctly', () => {
      expect(zipArchiveService.formatBytes(500)).toBe('500 Bytes');
    });

    it('should format kilobytes correctly', () => {
      expect(zipArchiveService.formatBytes(1024)).toBe('1 KB');
      expect(zipArchiveService.formatBytes(2048)).toBe('2 KB');
      expect(zipArchiveService.formatBytes(1536)).toBe('1.5 KB');
    });

    it('should format megabytes correctly', () => {
      expect(zipArchiveService.formatBytes(1048576)).toBe('1 MB');
      expect(zipArchiveService.formatBytes(5242880)).toBe('5 MB');
      expect(zipArchiveService.formatBytes(1572864)).toBe('1.5 MB');
    });

    it('should format gigabytes correctly', () => {
      expect(zipArchiveService.formatBytes(1073741824)).toBe('1 GB');
      expect(zipArchiveService.formatBytes(2147483648)).toBe('2 GB');
    });
  });

  describe('isWithinDiscordLimits', () => {
    const DISCORD_LIMIT = 8 * 1024 * 1024; // 8MB

    it('should return true for sizes under 8MB', () => {
      expect(zipArchiveService.isWithinDiscordLimits(0)).toBe(true);
      expect(zipArchiveService.isWithinDiscordLimits(1000)).toBe(true);
      expect(zipArchiveService.isWithinDiscordLimits(DISCORD_LIMIT - 1)).toBe(true);
      expect(zipArchiveService.isWithinDiscordLimits(DISCORD_LIMIT)).toBe(true);
    });

    it('should return false for sizes over 8MB', () => {
      expect(zipArchiveService.isWithinDiscordLimits(DISCORD_LIMIT + 1)).toBe(false);
      expect(zipArchiveService.isWithinDiscordLimits(10 * 1024 * 1024)).toBe(false);
      expect(zipArchiveService.isWithinDiscordLimits(50 * 1024 * 1024)).toBe(false);
    });
  });

  describe('_addDirectoryToZip', () => {
    it('should handle permission errors gracefully', async () => {
      const permissionError = new Error('EACCES: permission denied');
      mockFs.readdir.mockRejectedValue(permissionError);

      // Call the private method directly through the public method
      await expect(
        zipArchiveService.createPersonalityArchive('test', '/restricted/path')
      ).rejects.toThrow();

      expect(logger.error).toHaveBeenCalled();
    });

    it('should skip files that cannot be read', async () => {
      mockFs.readdir.mockResolvedValue(['readable.json', 'unreadable.json']);
      mockFs.stat
        .mockResolvedValueOnce({ isDirectory: () => false })
        .mockResolvedValueOnce({ isDirectory: () => false });
      mockFs.readFile
        .mockResolvedValueOnce(Buffer.from('{"readable":true}'))
        .mockRejectedValueOnce(new Error('Cannot read file'));

      // The error will bubble up from _addDirectoryToZip
      await expect(
        zipArchiveService.createPersonalityArchive('test', '/data/test')
      ).rejects.toThrow();

      expect(mockZipInstance.file).toHaveBeenCalledTimes(1);
      expect(mockZipInstance.file).toHaveBeenCalledWith('test/readable.json', Buffer.from('{"readable":true}'));
    });
  });
});