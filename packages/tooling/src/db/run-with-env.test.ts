import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Create mock spawn function that returns controllable process
const createMockProcess = () => {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
};

const mockSpawn = vi.fn();

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

// Mock env-runner utilities
const mockValidateEnvironment = vi.fn();
const mockShowEnvironmentBanner = vi.fn();
const mockRunWithRailway = vi.fn();
const mockConfirmProductionOperation = vi.fn();

vi.mock('../utils/env-runner.js', () => ({
  validateEnvironment: mockValidateEnvironment,
  showEnvironmentBanner: mockShowEnvironmentBanner,
  runWithRailway: mockRunWithRailway,
  confirmProductionOperation: mockConfirmProductionOperation,
}));

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: (s: string) => s,
    dim: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

describe('runWithEnv', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Mock process.exit to throw so we can catch it
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(code => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('should reject empty command', async () => {
    const { runWithEnv } = await import('./run-with-env.js');

    await expect(runWithEnv([], { env: 'dev' })).rejects.toThrow('process.exit(1)');
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('No command specified'));
  });

  it('should spawn command for local env', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc);

    const { runWithEnv } = await import('./run-with-env.js');
    const promise = runWithEnv(['echo', 'hello'], { env: 'local' });

    // Simulate successful process exit
    setImmediate(() => mockProc.emit('close', 0));

    await expect(promise).rejects.toThrow('process.exit(0)');

    expect(mockSpawn).toHaveBeenCalledWith(
      'echo',
      ['hello'],
      expect.objectContaining({
        stdio: 'inherit',
        shell: false,
      })
    );
  });

  it('should call runWithRailway for dev env', async () => {
    mockRunWithRailway.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const { runWithEnv } = await import('./run-with-env.js');

    await expect(runWithEnv(['tsx', 'script.ts'], { env: 'dev' })).rejects.toThrow(
      'process.exit(0)'
    );

    expect(mockRunWithRailway).toHaveBeenCalledWith('dev', 'tsx', ['script.ts']);
  });

  it('should require confirmation for prod without force', async () => {
    mockConfirmProductionOperation.mockResolvedValue(false);

    const { runWithEnv } = await import('./run-with-env.js');

    await expect(runWithEnv(['some', 'command'], { env: 'prod' })).rejects.toThrow(
      'process.exit(0)'
    );

    expect(mockConfirmProductionOperation).toHaveBeenCalledWith('run: some command');
    // Should exit before calling runWithRailway
    expect(mockRunWithRailway).not.toHaveBeenCalled();
  });

  it('should proceed for prod when confirmed', async () => {
    mockConfirmProductionOperation.mockResolvedValue(true);
    mockRunWithRailway.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const { runWithEnv } = await import('./run-with-env.js');

    await expect(runWithEnv(['npx', 'prisma', 'studio'], { env: 'prod' })).rejects.toThrow(
      'process.exit(0)'
    );

    expect(mockConfirmProductionOperation).toHaveBeenCalled();
    expect(mockRunWithRailway).toHaveBeenCalledWith('prod', 'npx', ['prisma', 'studio']);
  });

  it('should skip confirmation for prod with force flag', async () => {
    mockRunWithRailway.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

    const { runWithEnv } = await import('./run-with-env.js');

    await expect(
      runWithEnv(['npx', 'prisma', 'studio'], { env: 'prod', force: true })
    ).rejects.toThrow('process.exit(0)');

    expect(mockConfirmProductionOperation).not.toHaveBeenCalled();
    expect(mockRunWithRailway).toHaveBeenCalledWith('prod', 'npx', ['prisma', 'studio']);
  });

  it('should exit with command exit code', async () => {
    mockRunWithRailway.mockResolvedValue({ stdout: '', stderr: '', exitCode: 42 });

    const { runWithEnv } = await import('./run-with-env.js');

    await expect(runWithEnv(['failing', 'command'], { env: 'dev' })).rejects.toThrow(
      'process.exit(42)'
    );
  });

  it('should handle spawn errors for local env with enhanced message', async () => {
    const mockProc = createMockProcess();
    mockSpawn.mockReturnValue(mockProc);

    const { runWithEnv } = await import('./run-with-env.js');
    const promise = runWithEnv(['nonexistent'], { env: 'local' });

    // Simulate spawn error
    setImmediate(() => mockProc.emit('error', new Error('spawn nonexistent ENOENT')));

    // Error should include command name for better debugging
    await expect(promise).rejects.toThrow(
      "Failed to spawn 'nonexistent': spawn nonexistent ENOENT"
    );
  });
});
