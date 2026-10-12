import { describe, expect, it } from 'vitest';
import { boardFromFen } from '../../src/shared/board.ts';
import { handleSquareClick, type ClickContext } from '../../src/client/selection.ts';

const START = boardFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

function ctx(overrides: Partial<ClickContext> = {}): ClickContext {
  return { inGame: true, myTurn: true, myColor: 'w', selected: null, board: START, ...overrides };
}

describe('handleSquareClick', () => {
  it('selects your own piece', () => {
    expect(handleSquareClick(ctx(), 'e2')).toEqual({ selected: 'e2' });
  });

  it('moves the selected piece to the clicked square', () => {
    expect(handleSquareClick(ctx({ selected: 'e2' }), 'e4')).toEqual({
      selected: null,
      move: { from: 'e2', to: 'e4' },
    });
  });

  it('switches selection to another of your pieces', () => {
    expect(handleSquareClick(ctx({ selected: 'e2' }), 'd2')).toEqual({ selected: 'd2' });
  });

  it('deselects when clicking the selected piece again', () => {
    expect(handleSquareClick(ctx({ selected: 'e2' }), 'e2')).toEqual({ selected: null });
  });

  it('ignores empty squares and opponent pieces with nothing selected', () => {
    expect(handleSquareClick(ctx(), 'e4')).toEqual({ selected: null });
    expect(handleSquareClick(ctx(), 'e7')).toEqual({ selected: null });
  });

  it('works for black', () => {
    const black = ctx({ myColor: 'b' });
    expect(handleSquareClick(black, 'e7')).toEqual({ selected: 'e7' });
    expect(handleSquareClick(black, 'e2')).toEqual({ selected: null });
  });

  it('does nothing when not in a game', () => {
    expect(handleSquareClick(ctx({ inGame: false }), 'e2')).toEqual({ selected: null });
  });

  it("does nothing on the opponent's turn", () => {
    expect(handleSquareClick(ctx({ myTurn: false, selected: 'e2' }), 'e4')).toEqual({ selected: null });
  });

  it('auto-promotes pawns to a queen', () => {
    const board = boardFromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(handleSquareClick(ctx({ board, selected: 'a7' }), 'a8')).toEqual({
      selected: null,
      move: { from: 'a7', to: 'a8', promotion: 'q' },
    });
  });
});
