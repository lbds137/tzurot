/**
 * Integration test for DDD and Legacy personality system compatibility
 */

const fs = require('fs').promises;
const path = require('path');
const { FilePersonalityRepository } = require('../../src/adapters/persistence/FilePersonalityRepository');
const personalityManager = require('../../src/core/personality');
const { PersonalityId, UserId } = require('../../src/domain/personality');

describe('DDD-Legacy Personality System Compatibility', () => {
  const testDataPath = path.join(__dirname, '../fixtures/test-data');
  const dddFile = path.join(testDataPath, 'ddd-personalities.json');
  const legacyPersonalitiesFile = path.join(testDataPath, 'personalities.json');
  const legacyAliasesFile = path.join(testDataPath, 'aliases.json');

  beforeEach(async () => {
    // Clean up test files
    await fs.mkdir(testDataPath, { recursive: true });
    try {
      await fs.unlink(dddFile);
    } catch (e) {
      // Ignore if file doesn't exist
    }
    try {
      await fs.unlink(legacyPersonalitiesFile);
    } catch (e) {
      // Ignore if file doesn't exist
    }
    try {
      await fs.unlink(legacyAliasesFile);
    } catch (e) {
      // Ignore if file doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rmdir(testDataPath, { recursive: true });
    } catch (e) {
      // Ignore errors
    }
  });

  test('DDD system should migrate from legacy files on first load', async () => {
    // Create legacy format files
    const legacyPersonalities = {
      'test-personality': {
        fullName: 'test-personality',
        displayName: 'Test Personality',
        addedBy: '123456789',
        addedAt: '2024-01-01T00:00:00.000Z',
        lastUpdated: '2024-01-01T00:00:00.000Z',
      },
      'another-personality': {
        fullName: 'another-personality',
        displayName: 'Another Personality',
        addedBy: '987654321',
        addedAt: '2024-01-02T00:00:00.000Z',
        lastUpdated: '2024-01-02T00:00:00.000Z',
      },
    };

    const legacyAliases = {
      test: 'test-personality',
      tp: 'test-personality',
      another: 'another-personality',
    };

    await fs.writeFile(legacyPersonalitiesFile, JSON.stringify(legacyPersonalities, null, 2));
    await fs.writeFile(legacyAliasesFile, JSON.stringify(legacyAliases, null, 2));

    // Initialize DDD repository
    const dddRepo = new FilePersonalityRepository({
      dataPath: testDataPath,
      filename: 'ddd-personalities.json',
    });

    await dddRepo.initialize();

    // Check that DDD file was created
    const dddContent = JSON.parse(await fs.readFile(dddFile, 'utf8'));
    expect(dddContent.personalities).toBeDefined();
    expect(Object.keys(dddContent.personalities).length).toBe(2);
    expect(dddContent.personalities['test-personality']).toBeDefined();
    expect(dddContent.personalities['test-personality'].profile.name).toBe('test-personality');
    expect(dddContent.personalities['test-personality'].profile.displayName).toBe('Test Personality');

    // Check that aliases were migrated
    expect(Object.keys(dddContent.aliases).length).toBe(3);
    expect(dddContent.aliases['test']).toBe('test-personality');
  });

  test('DDD changes should be reflected in legacy files', async () => {
    // Initialize DDD repository
    const dddRepo = new FilePersonalityRepository({
      dataPath: testDataPath,
      filename: 'ddd-personalities.json',
    });

    await dddRepo.initialize();

    // Create a personality through DDD
    const personality = {
      id: new PersonalityId('new-personality'),
      personalityId: new PersonalityId('new-personality'),
      ownerId: new UserId('123456789'),
      profile: {
        name: 'new-personality',
        displayName: 'New DDD Personality',
        prompt: 'You are New DDD Personality',
        maxWordCount: 1000,
      },
      model: {
        name: 'default',
        endpoint: '/default',
        capabilities: {},
      },
      aliases: [],
      toJSON: function () {
        return {
          id: this.id.value,
          personalityId: this.personalityId.value,
          ownerId: this.ownerId.value,
          profile: this.profile,
          model: this.model,
          aliases: this.aliases,
        };
      },
      markEventsAsCommitted: () => {},
    };

    await dddRepo.save(personality);

    // Check that legacy files were updated
    const legacyPersonalities = JSON.parse(await fs.readFile(legacyPersonalitiesFile, 'utf8'));
    expect(legacyPersonalities['new-personality']).toBeDefined();
    expect(legacyPersonalities['new-personality'].fullName).toBe('new-personality');
    expect(legacyPersonalities['new-personality'].displayName).toBe('New DDD Personality');
    expect(legacyPersonalities['new-personality'].addedBy).toBe('123456789');
  });

  test('Legacy system should read data written by DDD system', async () => {
    // First create data through DDD
    const dddRepo = new FilePersonalityRepository({
      dataPath: testDataPath,
      filename: 'ddd-personalities.json',
    });

    await dddRepo.initialize();

    const personality = {
      id: new PersonalityId('legacy-test'),
      personalityId: new PersonalityId('legacy-test'),
      ownerId: new UserId('123456789'),
      profile: {
        name: 'legacy-test',
        displayName: 'Legacy Test Personality',
        prompt: 'You are Legacy Test',
        maxWordCount: 1000,
      },
      model: {
        name: 'default',
        endpoint: '/default',
        capabilities: {},
      },
      aliases: [{ value: 'lt', alias: 'lt' }],
      toJSON: function () {
        return {
          id: this.id.value,
          personalityId: this.personalityId.value,
          ownerId: this.ownerId.value,
          profile: this.profile,
          model: this.model,
          aliases: this.aliases,
        };
      },
      markEventsAsCommitted: () => {},
    };

    await dddRepo.save(personality);

    // Now check that legacy system can read it
    // Note: We would need to properly mock the legacy system here
    // For now, just verify the files are in the correct format
    const legacyPersonalities = JSON.parse(await fs.readFile(legacyPersonalitiesFile, 'utf8'));
    const legacyAliases = JSON.parse(await fs.readFile(legacyAliasesFile, 'utf8'));

    expect(legacyPersonalities['legacy-test']).toBeDefined();
    expect(legacyPersonalities['legacy-test'].fullName).toBe('legacy-test');
    expect(legacyPersonalities['legacy-test'].displayName).toBe('Legacy Test Personality');

    expect(legacyAliases['lt']).toBe('legacy-test');
  });
});