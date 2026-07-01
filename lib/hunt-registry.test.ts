import { describe, it, expect, beforeEach } from 'vitest';
import { activeTasks, abortTask, registerTask, unregisterTask, isTaskRunning } from './hunt-registry';

describe('hunt-registry.ts', () => {
  beforeEach(() => {
    // Clean up active tasks
    activeTasks.clear();
  });

  describe('registerTask', () => {
    it('should register a new task', () => {
      registerTask(1);
      expect(activeTasks.has(1)).toBe(true);
      expect(activeTasks.get(1)?.aborted).toBe(false);
    });

    it('should allow registering multiple tasks', () => {
      registerTask(1);
      registerTask(2);
      registerTask(3);
      expect(activeTasks.size).toBe(3);
    });

    it('should overwrite existing task with same id', () => {
      registerTask(1);
      activeTasks.get(1)!.aborted = true;
      registerTask(1);
      expect(activeTasks.get(1)?.aborted).toBe(false);
    });
  });

  describe('unregisterTask', () => {
    it('should remove task from registry', () => {
      registerTask(1);
      unregisterTask(1);
      expect(activeTasks.has(1)).toBe(false);
    });

    it('should not throw for non-existent task', () => {
      expect(() => unregisterTask(999)).not.toThrow();
    });
  });

  describe('abortTask', () => {
    it('should mark task as aborted', () => {
      registerTask(1);
      const result = abortTask(1);
      expect(result).toBe(true);
      expect(activeTasks.get(1)?.aborted).toBe(true);
    });

    it('should return false for non-existent task', () => {
      const result = abortTask(999);
      expect(result).toBe(false);
    });

    it('should allow aborting same task multiple times', () => {
      registerTask(1);
      abortTask(1);
      abortTask(1);
      expect(activeTasks.get(1)?.aborted).toBe(true);
    });
  });

  describe('isTaskRunning', () => {
    it('should return true for registered non-aborted task', () => {
      registerTask(1);
      expect(isTaskRunning(1)).toBe(true);
    });

    it('should return false for aborted task', () => {
      registerTask(1);
      abortTask(1);
      expect(isTaskRunning(1)).toBe(false);
    });

    it('should return false for non-existent task', () => {
      expect(isTaskRunning(999)).toBe(false);
    });

    it('should return false after task is unregistered', () => {
      registerTask(1);
      unregisterTask(1);
      expect(isTaskRunning(1)).toBe(false);
    });
  });

  describe('activeTasks Map', () => {
    it('should be empty initially', () => {
      expect(activeTasks.size).toBe(0);
    });

    it('should maintain correct state across multiple operations', () => {
      registerTask(1);
      registerTask(2);
      registerTask(3);

      expect(activeTasks.size).toBe(3);
      expect(isTaskRunning(1)).toBe(true);
      expect(isTaskRunning(2)).toBe(true);

      abortTask(2);
      expect(isTaskRunning(2)).toBe(false);

      unregisterTask(1);
      expect(activeTasks.size).toBe(2);
      expect(isTaskRunning(1)).toBe(false);
      expect(isTaskRunning(3)).toBe(true);
    });
  });
});
