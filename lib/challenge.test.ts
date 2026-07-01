import { describe, it, expect } from 'vitest';
import { generateChallenge, validateResponse, type Challenge } from './challenge';

describe('challenge.ts', () => {
  describe('generateChallenge', () => {
    it('should generate a valid challenge object', () => {
      const challenge = generateChallenge();

      expect(challenge).toHaveProperty('prompt');
      expect(challenge).toHaveProperty('expectedAnswer');
      expect(challenge).toHaveProperty('difficulty');

      expect(typeof challenge.prompt).toBe('string');
      expect(challenge.prompt.length).toBeGreaterThan(0);

      expect(typeof challenge.expectedAnswer).toBe('string');
      expect(challenge.expectedAnswer.length).toBeGreaterThan(0);

      expect([1, 2]).toContain(challenge.difficulty);
    });

    it('should generate different challenges on multiple calls', () => {
      const challenges = new Set<string>();
      for (let i = 0; i < 20; i++) {
        challenges.add(generateChallenge().prompt);
      }
      // Should have at least some variety
      expect(challenges.size).toBeGreaterThan(1);
    });

    it('should generate difficulty 1 challenges with correct format', () => {
      // Generate multiple to find a difficulty 1
      let challenge: Challenge | null = null;
      for (let i = 0; i < 50; i++) {
        challenge = generateChallenge();
        if (challenge.difficulty === 1) break;
      }

      expect(challenge).not.toBeNull();
      if (challenge?.difficulty === 1) {
        expect(challenge.prompt).toContain('Category:');
        expect(challenge.prompt).toContain('Options:');
      }
    });

    it('should generate difficulty 2 challenges with correct format', () => {
      // Generate multiple to find a difficulty 2
      let challenge: Challenge | null = null;
      for (let i = 0; i < 50; i++) {
        challenge = generateChallenge();
        if (challenge.difficulty === 2) break;
      }

      expect(challenge).not.toBeNull();
      if (challenge?.difficulty === 2) {
        expect(challenge.prompt).toContain('Passage:');
        expect(challenge.prompt).toContain('Question:');
      }
    });
  });

  describe('validateResponse', () => {
    it('should validate correct answer', () => {
      const result = validateResponse('apple', 'apple');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('apple');
    });

    it('should validate case-insensitive answer', () => {
      const result = validateResponse('APPLE', 'apple');
      expect(result.valid).toBe(true);
    });

    it('should validate answer with extra text', () => {
      const result = validateResponse('The answer is apple', 'apple');
      expect(result.valid).toBe(true);
    });

    it('should reject wrong answer', () => {
      const result = validateResponse('banana', 'apple');
      expect(result.valid).toBe(false);
    });

    it('should handle empty response', () => {
      const result = validateResponse('', 'apple');
      expect(result.valid).toBe(false);
      expect(result.normalized).toBeNull();
    });

    it('should handle null response', () => {
      const result = validateResponse(null as unknown as string, 'apple');
      expect(result.valid).toBe(false);
    });

    it('should handle empty expected answer', () => {
      const result = validateResponse('apple', '');
      expect(result.valid).toBe(false);
    });

    it('should strip punctuation from response', () => {
      const result = validateResponse('apple.', 'apple');
      expect(result.valid).toBe(true);
    });

    it('should not match partial words', () => {
      const result = validateResponse('pineapple', 'apple');
      expect(result.valid).toBe(false);
    });

    it('should truncate long normalized text', () => {
      const longResponse = 'a'.repeat(200);
      const result = validateResponse(longResponse, 'test');
      expect(result.normalized!.length).toBeLessThanOrEqual(101);
    });
  });
});
