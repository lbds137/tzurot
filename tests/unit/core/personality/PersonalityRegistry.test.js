const PersonalityRegistry = require('../../../../src/core/personality/PersonalityRegistry');

describe('PersonalityRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new PersonalityRegistry();
  });

  describe('register', () => {
    it('should register a new personality', () => {
      const personality = {
        fullName: 'test-personality',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };

      const result = registry.register('test-personality', personality);
      
      expect(result).toBe(true);
      expect(registry.size).toBe(1);
      expect(registry.get('test-personality')).toEqual(personality);
    });

    it('should not register duplicate personalities', () => {
      const personality = {
        fullName: 'test-personality',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };

      registry.register('test-personality', personality);
      const result = registry.register('test-personality', personality);
      
      expect(result).toBe(false);
      expect(registry.size).toBe(1);
    });
  });

  describe('get', () => {
    it('should retrieve a registered personality', () => {
      const personality = {
        fullName: 'test-personality',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };

      registry.register('test-personality', personality);
      const retrieved = registry.get('test-personality');
      
      expect(retrieved).toEqual(personality);
    });

    it('should return null for non-existent personality', () => {
      const retrieved = registry.get('non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove a personality and its aliases', () => {
      const personality = {
        fullName: 'test-personality',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };

      registry.register('test-personality', personality);
      registry.setAlias('test-alias', 'test-personality');
      
      const result = registry.remove('test-personality');
      
      expect(result).toBe(true);
      expect(registry.size).toBe(0);
      expect(registry.get('test-personality')).toBeNull();
      expect(registry.getByAlias('test-alias')).toBeNull();
    });

    it('should return false when removing non-existent personality', () => {
      const result = registry.remove('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('alias management', () => {
    beforeEach(() => {
      const personality = {
        fullName: 'test-personality',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };
      registry.register('test-personality', personality);
    });

    it('should set an alias for a personality', () => {
      const result = registry.setAlias('test-alias', 'test-personality');
      
      expect(result).toBe(true);
      expect(registry.getByAlias('test-alias')).toBeTruthy();
    });

    it('should not set alias for non-existent personality', () => {
      const result = registry.setAlias('test-alias', 'non-existent');
      
      expect(result).toBe(false);
      expect(registry.getByAlias('test-alias')).toBeNull();
    });

    it('should reassign alias to new personality', () => {
      const personality2 = {
        fullName: 'test-personality-2',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };
      registry.register('test-personality-2', personality2);
      
      registry.setAlias('test-alias', 'test-personality');
      registry.setAlias('test-alias', 'test-personality-2');
      
      const retrieved = registry.getByAlias('test-alias');
      expect(retrieved.fullName).toBe('test-personality-2');
    });

    it('should get all aliases for a personality', () => {
      registry.setAlias('alias1', 'test-personality');
      registry.setAlias('alias2', 'test-personality');
      registry.setAlias('alias3', 'test-personality');
      
      const aliases = registry.getAliases('test-personality');
      
      expect(aliases).toHaveLength(3);
      expect(aliases).toContain('alias1');
      expect(aliases).toContain('alias2');
      expect(aliases).toContain('alias3');
    });

    it('should remove an alias', () => {
      registry.setAlias('test-alias', 'test-personality');
      
      const result = registry.removeAlias('test-alias');
      
      expect(result).toBe(true);
      expect(registry.getByAlias('test-alias')).toBeNull();
    });
  });

  describe('getByUser', () => {
    it('should return personalities for a specific user', () => {
      const personality1 = {
        fullName: 'personality-1',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };
      const personality2 = {
        fullName: 'personality-2',
        addedBy: 'user456',
        addedAt: new Date().toISOString()
      };
      const personality3 = {
        fullName: 'personality-3',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };

      registry.register('personality-1', personality1);
      registry.register('personality-2', personality2);
      registry.register('personality-3', personality3);
      
      const userPersonalities = registry.getByUser('user123');
      
      expect(userPersonalities).toHaveLength(2);
      expect(userPersonalities[0].fullName).toBe('personality-1');
      expect(userPersonalities[1].fullName).toBe('personality-3');
    });
  });

  describe('data import/export', () => {
    it('should export data as plain objects', () => {
      const personality = {
        fullName: 'test-personality',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };
      registry.register('test-personality', personality);
      registry.setAlias('test-alias', 'test-personality');
      
      const exported = registry.exportToObjects();
      
      expect(exported.personalities['test-personality']).toEqual(personality);
      expect(exported.aliases['test-alias']).toBe('test-personality');
    });

    it('should load data from plain objects', () => {
      const personalities = {
        'personality-1': {
          fullName: 'personality-1',
          addedBy: 'user123',
          addedAt: new Date().toISOString()
        },
        'personality-2': {
          fullName: 'personality-2',
          addedBy: 'user456',
          addedAt: new Date().toISOString()
        }
      };
      const aliases = {
        'alias-1': 'personality-1',
        'alias-2': 'personality-2'
      };
      
      registry.loadFromObjects(personalities, aliases);
      
      expect(registry.size).toBe(2);
      expect(registry.get('personality-1')).toEqual(personalities['personality-1']);
      expect(registry.getByAlias('alias-1')).toEqual(personalities['personality-1']);
    });

    it('should skip mismatched entries when loading', () => {
      const personalities = {
        'wrong-key': {
          fullName: 'correct-name',
          addedBy: 'user123',
          addedAt: new Date().toISOString()
        },
        'correct-key': {
          fullName: 'correct-key',
          addedBy: 'user456',
          addedAt: new Date().toISOString()
        }
      };
      
      registry.loadFromObjects(personalities, {});
      
      expect(registry.size).toBe(1);
      expect(registry.get('correct-key')).toBeTruthy();
      expect(registry.get('wrong-key')).toBeNull();
    });

    it('should skip aliases for non-existent personalities', () => {
      const personalities = {
        'personality-1': {
          fullName: 'personality-1',
          addedBy: 'user123',
          addedAt: new Date().toISOString()
        }
      };
      const aliases = {
        'alias-1': 'personality-1',
        'alias-2': 'non-existent'
      };
      
      registry.loadFromObjects(personalities, aliases);
      
      expect(registry.aliases.size).toBe(1);
      expect(registry.getByAlias('alias-1')).toBeTruthy();
      expect(registry.getByAlias('alias-2')).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all data', () => {
      const personality = {
        fullName: 'test-personality',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };
      registry.register('test-personality', personality);
      registry.setAlias('test-alias', 'test-personality');
      
      registry.clear();
      
      expect(registry.size).toBe(0);
      expect(registry.aliases.size).toBe(0);
    });
  });

  describe('getAll', () => {
    it('should return all personalities as an array', () => {
      const personality1 = {
        fullName: 'personality-1',
        addedBy: 'user123',
        addedAt: new Date().toISOString()
      };
      const personality2 = {
        fullName: 'personality-2',
        addedBy: 'user456',
        addedAt: new Date().toISOString()
      };

      registry.register('personality-1', personality1);
      registry.register('personality-2', personality2);
      
      const all = registry.getAll();
      
      expect(all).toHaveLength(2);
      expect(all[0].fullName).toBe('personality-1');
      expect(all[1].fullName).toBe('personality-2');
    });
  });
});