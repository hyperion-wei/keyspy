import { describe, it, expect, beforeEach } from 'vitest';
import { getOrCreateClientCache } from './client-cache';

describe('client-cache.ts', () => {
  beforeEach(() => {
    // Clean up global caches before each test
    (globalThis as any).__KEYSPY_OPENAI_CLIENTS__ = undefined;
    (globalThis as any).__KEYSPY_GEMINI_CLIENTS__ = undefined;
    (globalThis as any).__KEYSPY_ANTHROPIC_CLIENTS__ = undefined;
  });

  describe('getOrCreateClientCache', () => {
    it('should create a new cache if none exists', () => {
      const cache = getOrCreateClientCache('__KEYSPY_OPENAI_CLIENTS__');
      expect(cache).toBeInstanceOf(Map);
      expect(cache.size).toBe(0);
    });

    it('should return existing cache on subsequent calls', () => {
      const cache1 = getOrCreateClientCache('__KEYSPY_OPENAI_CLIENTS__');
      const cache2 = getOrCreateClientCache('__KEYSPY_OPENAI_CLIENTS__');
      expect(cache1).toBe(cache2);
    });

    it('should persist data across calls', () => {
      const cache1 = getOrCreateClientCache('__KEYSPY_OPENAI_CLIENTS__');
      cache1.set('key1', { client: 'mock-client-1' });

      const cache2 = getOrCreateClientCache('__KEYSPY_OPENAI_CLIENTS__');
      expect(cache2.get('key1')).toEqual({ client: 'mock-client-1' });
    });

    it('should maintain separate caches for different providers', () => {
      const openaiCache = getOrCreateClientCache('__KEYSPY_OPENAI_CLIENTS__');
      const geminiCache = getOrCreateClientCache('__KEYSPY_GEMINI_CLIENTS__');
      const anthropicCache = getOrCreateClientCache('__KEYSPY_ANTHROPIC_CLIENTS__');

      expect(openaiCache).not.toBe(geminiCache);
      expect(openaiCache).not.toBe(anthropicCache);
      expect(geminiCache).not.toBe(anthropicCache);

      openaiCache.set('key', 'openai-client');
      geminiCache.set('key', 'gemini-client');

      expect(openaiCache.get('key')).toBe('openai-client');
      expect(geminiCache.get('key')).toBe('gemini-client');
    });

    it('should store cache in globalThis', () => {
      const cache = getOrCreateClientCache('__KEYSPY_OPENAI_CLIENTS__');
      expect((globalThis as any).__KEYSPY_OPENAI_CLIENTS__).toBe(cache);
    });
  });
});
