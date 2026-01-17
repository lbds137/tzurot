import { describe, it, expect, beforeEach } from 'vitest';
import { cac } from 'cac';
import { registerRunCommands } from './run.js';

/**
 * Tests for the `run` command registration.
 *
 * Note: We only test command registration and option parsing here.
 * The actual runWithEnv logic is thoroughly tested in run-with-env.test.ts.
 * Testing cac action invocation is complex and provides low value since
 * the action is a thin wrapper that passes args to runWithEnv.
 */
describe('registerRunCommands', () => {
  let cli: ReturnType<typeof cac>;

  beforeEach(() => {
    cli = cac('test');
  });

  it('should register run command with correct description', () => {
    registerRunCommands(cli);

    const commands = cli.commands;
    const runCommand = commands.find(cmd => cmd.name === 'run');

    expect(runCommand).toBeDefined();
    expect(runCommand?.description).toBe('Run a command with Railway DATABASE_URL injected');
  });

  it('should have --env option with dev as default', () => {
    registerRunCommands(cli);

    const runCommand = cli.commands.find(cmd => cmd.name === 'run');
    const envOption = runCommand?.options.find(opt => opt.name === 'env');

    expect(envOption).toBeDefined();
    expect(envOption?.config.default).toBe('dev');
  });

  it('should have --force option for skipping production confirmation', () => {
    registerRunCommands(cli);

    const runCommand = cli.commands.find(cmd => cmd.name === 'run');
    const forceOption = runCommand?.options.find(opt => opt.name === 'force');

    expect(forceOption).toBeDefined();
  });

  it('should use variadic command pattern to capture all args', () => {
    registerRunCommands(cli);

    const runCommand = cli.commands.find(cmd => cmd.name === 'run');

    // Variadic commands in cac use [...name] pattern which results in 'name' with variadic flag
    expect(runCommand?.args).toContainEqual(
      expect.objectContaining({
        variadic: true,
      })
    );
  });

  it('should parse options correctly from command line', () => {
    registerRunCommands(cli);

    // Parse without running the action
    cli.parse(['', '', 'run', '--env', 'prod', '--force', 'tsx', 'script.ts'], { run: false });

    expect(cli.matchedCommand?.name).toBe('run');
    expect(cli.options.env).toBe('prod');
    expect(cli.options.force).toBe(true);
  });

  it('should capture variadic args correctly', () => {
    registerRunCommands(cli);

    // Note: cac interprets flags like --filter itself, so we test with non-flag args
    cli.parse(['', '', 'run', 'tsx', 'scripts/some-script.ts', 'arg1'], { run: false });

    // The variadic args should be available in cli.args
    expect(cli.args).toEqual(['tsx', 'scripts/some-script.ts', 'arg1']);
  });
});
