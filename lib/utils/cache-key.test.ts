import { describe, it, expect } from 'vitest';
import { stableStringify } from './cache-key';

describe('cache-key.ts', () => {
  describe('stableStringify', () => {
    it('should return empty string for null', () => {
      expect(stableStringify(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(stableStringify(undefined)).toBe('');
    });

    it('should return empty string for empty object', () => {
      expect(stableStringify({})).toBe('');
    });

    it('should stringify single key object', () => {
      expect(stableStringify({ a: '1' })).toBe('a=1');
    });

    it('should stringify multiple keys', () => {
      expect(stableStringify({ a: '1', b: '2' })).toBe('a=1&b=2');
    });

    it('should sort keys alphabetically', () => {
      expect(stableStringify({ b: '2', a: '1' })).toBe('a=1&b=2');
    });

    it('should produce same output regardless of key order', () => {
      const obj1 = { z: 'last', a: 'first', m: 'middle' };
      const obj2 = { a: 'first', m: 'middle', z: 'last' };
      expect(stableStringify(obj1)).toBe(stableStringify(obj2));
    });

    it('should handle special characters in values', () => {
      expect(stableStringify({ url: 'https://api.com/v1' })).toBe('url=https://api.com/v1');
    });

    it('should handle empty string values', () => {
      expect(stableStringify({ a: '', b: 'value' })).toBe('a=&b=value');
    });
  });
});
