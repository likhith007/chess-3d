import { describe, expect, it } from 'vitest';
import { boardFromFen, isPromotionMove } from '../../src/shared/board.ts';

describe('boardFromFen', () => {
  it('maps the starting position to squares', () => {
    const board = boardFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    expect(board.get('e1')).toBe('K');
    expect(board.get('d8')).toBe('q');
    expect(board.get('a2')).toBe('P');
    expect(board.get('e4')).toBeUndefined();
    expect(board.size).toBe(32);
  });

  it('handles empty-square runs mid-rank', () => {
    const board = boardFromFen('8/8/8/3k4/8/8/8/K7 w - - 0 1');
    expect(board.get('d5')).toBe('k');
    expect(board.get('a1')).toBe('K');
    expect(board.size).toBe(2);
  });
});

describe('isPromotionMove', () => {
  it('detects pawns reaching the last rank', () => {
    expect(isPromotionMove('P', 'e8')).toBe(true);
    expect(isPromotionMove('p', 'a1')).toBe(true);
    expect(isPromotionMove('P', 'e7')).toBe(false);
    expect(isPromotionMove('Q', 'e8')).toBe(false);
  });
});
