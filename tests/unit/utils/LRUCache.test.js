const LRUCache = require('../../../src/utils/LRUCache');

describe('LRUCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should create cache with default options', () => {
      const cache = new LRUCache();

      expect(cache.maxSize).toBe(1000);
      expect(cache.ttl).toBeNull();
      expect(cache.size).toBe(0);
    });

    it('should create cache with custom options', () => {
      const cache = new LRUCache({ maxSize: 100, ttl: 60000 });

      expect(cache.maxSize).toBe(100);
      expect(cache.ttl).toBe(60000);
    });

    it('should throw error for invalid maxSize', () => {
      expect(() => new LRUCache({ maxSize: 0 })).toThrow('maxSize must be a positive integer');
      expect(() => new LRUCache({ maxSize: -1 })).toThrow('maxSize must be a positive integer');
      expect(() => new LRUCache({ maxSize: 'abc' })).toThrow('maxSize must be a positive integer');
    });
  });

  describe('basic operations', () => {
    let cache;

    beforeEach(() => {
      cache = new LRUCache({ maxSize: 3 });
    });

    it('should set and get values', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      cache.set('key1', 'value1');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should delete keys', () => {
      cache.set('key1', 'value1');

      expect(cache.delete('key1')).toBe(true);
      expect(cache.has('key1')).toBe(false);
      expect(cache.delete('nonexistent')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
    });

    it('should support method chaining', () => {
      const result = cache.set('key1', 'value1').set('key2', 'value2');

      expect(result).toBe(cache);
      expect(cache.size).toBe(2);
    });
  });

  describe('LRU eviction', () => {
    let cache;
    let onEvict;

    beforeEach(() => {
      onEvict = jest.fn();
      cache = new LRUCache({ maxSize: 3, onEvict });
    });

    it('should evict least recently used item when full', () => {
      cache.set('a', 1);
      jest.advanceTimersByTime(100);
      cache.set('b', 2);
      jest.advanceTimersByTime(100);
      cache.set('c', 3);
      jest.advanceTimersByTime(100);

      // Cache is now full [a, b, c]
      cache.set('d', 4); // Should evict 'a' (least recently used)

      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(onEvict).toHaveBeenCalledWith('a', 1);
    });

    it('should update LRU order on get', () => {
      cache.set('a', 1);
      jest.advanceTimersByTime(100);
      cache.set('b', 2);
      jest.advanceTimersByTime(100);
      cache.set('c', 3);
      jest.advanceTimersByTime(100);

      // Access 'a' to make it recently used
      cache.get('a');
      jest.advanceTimersByTime(100);

      // Now 'b' is least recently used
      cache.set('d', 4); // Should evict 'b'

      expect(cache.has('a')).toBe(true);
      expect(cache.has('b')).toBe(false);
      expect(cache.has('c')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(onEvict).toHaveBeenCalledWith('b', 2);
    });

    it('should update LRU order on has', () => {
      cache.set('a', 1);
      jest.advanceTimersByTime(100);
      cache.set('b', 2);
      jest.advanceTimersByTime(100);
      cache.set('c', 3);
      jest.advanceTimersByTime(100);

      // Check 'a' to make it recently used
      cache.has('a');
      jest.advanceTimersByTime(100);

      // Now 'b' is least recently used
      cache.set('d', 4); // Should evict 'b'

      expect(cache.has('b')).toBe(false);
      expect(onEvict).toHaveBeenCalledWith('b', 2);
    });

    it('should update existing keys without eviction', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);

      // Update existing key
      cache.set('a', 'updated');

      expect(cache.size).toBe(3);
      expect(cache.get('a')).toBe('updated');
      expect(onEvict).not.toHaveBeenCalled();
    });
  });

  describe('TTL expiration', () => {
    let cache;

    beforeEach(() => {
      cache = new LRUCache({ maxSize: 10, ttl: 1000 }); // 1 second TTL
    });

    it('should expire entries after TTL', () => {
      cache.set('key1', 'value1');

      expect(cache.get('key1')).toBe('value1');

      jest.advanceTimersByTime(1001);

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.has('key1')).toBe(false);
    });

    it('should cleanup expired entries', () => {
      cache.set('key1', 'value1');
      jest.advanceTimersByTime(500);
      cache.set('key2', 'value2');
      jest.advanceTimersByTime(600); // key1 expired, key2 still valid

      cache.cleanupExpired();

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
    });

    it('should call onEvict for expired entries', () => {
      const onEvict = jest.fn();
      cache = new LRUCache({ maxSize: 10, ttl: 1000, onEvict });

      cache.set('key1', 'value1');
      jest.advanceTimersByTime(1001);

      cache.get('key1'); // Triggers expiration

      expect(onEvict).toHaveBeenCalledWith('key1', 'value1');
    });
  });

  describe('iteration methods', () => {
    let cache;

    beforeEach(() => {
      cache = new LRUCache({ maxSize: 5 });
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
    });

    it('should iterate over keys', () => {
      const keys = Array.from(cache.keys());

      expect(keys).toHaveLength(3);
      expect(keys).toContain('a');
      expect(keys).toContain('b');
      expect(keys).toContain('c');
    });

    it('should iterate over values', () => {
      const values = Array.from(cache.values());

      expect(values).toHaveLength(3);
      expect(values).toContain(1);
      expect(values).toContain(2);
      expect(values).toContain(3);
    });

    it('should iterate over entries', () => {
      const entries = Array.from(cache.entries());

      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual(['a', 1]);
      expect(entries).toContainEqual(['b', 2]);
      expect(entries).toContainEqual(['c', 3]);
    });
  });

  describe('statistics', () => {
    it('should return cache stats', () => {
      const cache = new LRUCache({ maxSize: 5, ttl: 1000 });
      cache.set('a', 1);
      cache.set('b', 2);

      jest.advanceTimersByTime(1001);
      cache.set('c', 3);

      const stats = cache.getStats();

      expect(stats.size).toBe(3);
      expect(stats.maxSize).toBe(5);
      expect(stats.ttl).toBe(1000);
      expect(stats.expiredCount).toBe(2); // a and b expired
    });
  });

  describe('edge cases', () => {
    it('should handle cache of size 1', () => {
      const cache = new LRUCache({ maxSize: 1 });

      cache.set('a', 1);
      cache.set('b', 2);

      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
    });

    it('should handle various key types', () => {
      const cache = new LRUCache({ maxSize: 10 });
      const objKey = { id: 1 };
      const symKey = Symbol('test');

      cache.set('string', 1);
      cache.set(123, 2);
      cache.set(objKey, 3);
      cache.set(symKey, 4);
      cache.set(null, 5);
      cache.set(undefined, 6);

      expect(cache.get('string')).toBe(1);
      expect(cache.get(123)).toBe(2);
      expect(cache.get(objKey)).toBe(3);
      expect(cache.get(symKey)).toBe(4);
      expect(cache.get(null)).toBe(5);
      expect(cache.get(undefined)).toBe(6);
    });

    it('should call onEvict when clearing cache', () => {
      const onEvict = jest.fn();
      const cache = new LRUCache({ maxSize: 5, onEvict });

      cache.set('a', 1);
      cache.set('b', 2);

      cache.clear();

      expect(onEvict).toHaveBeenCalledTimes(2);
      expect(onEvict).toHaveBeenCalledWith('a', 1);
      expect(onEvict).toHaveBeenCalledWith('b', 2);
    });
  });
});
