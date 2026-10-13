import { describe, it, expect } from 'vitest';
import { add, multiply, subtract } from '../../src/utils/math.helper.js';

describe('math.helper', () => {
  describe('add', () => {
    it('adds two positive numbers', () => {
      expect(add(2, 3)).toBe(5);
    });

    it('adds a positive and a negative number', () => {
      expect(add(10, -4)).toBe(6);
    });

    it('adds two negative numbers', () => {
      expect(add(-2, -3)).toBe(-5);
    });

    it('returns the other operand when adding zero', () => {
      expect(add(7, 0)).toBe(7);
      expect(add(0, 7)).toBe(7);
    });

    it('handles floating point numbers', () => {
      expect(add(0.1, 0.2)).toBeCloseTo(0.3);
    });
  });

  describe('multiply', () => {
    it('multiplies two positive numbers', () => {
      expect(multiply(3, 4)).toBe(12);
    });

    it('multiplies a positive and a negative number', () => {
      expect(multiply(5, -2)).toBe(-10);
    });

    it('multiplies two negative numbers to a positive result', () => {
      expect(multiply(-3, -4)).toBe(12);
    });

    it('returns zero when either operand is zero', () => {
      expect(multiply(0, 99)).toBe(0);
      expect(multiply(99, 0)).toBe(0);
    });

    it('handles floating point numbers', () => {
      expect(multiply(0.5, 4)).toBe(2);
    });
  });

  describe('subtract', () => {
    it('subtracts two positive numbers', () => {
      expect(subtract(5, 3)).toBe(2);
    });

    it('subtracts a positive and a negative number', () => {
      expect(subtract(10, -4)).toBe(14);
    });

    it('subtracts two negative numbers', () => {
      expect(subtract(-2, -3)).toBe(1);
    });

    it('returns the negated operand when subtracting from zero', () => {
      expect(subtract(0, 7)).toBe(-7);
      expect(subtract(7, 0)).toBe(7);
    });

    it('handles floating point numbers', () => {
      expect(subtract(0.3, 0.1)).toBeCloseTo(0.2);
    });
  });
});
  
