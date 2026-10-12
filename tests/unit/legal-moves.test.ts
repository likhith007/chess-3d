import { describe, expect, it } from 'vitest';
import { Game } from '../../src/server/game.ts';

/** Builds a game at `fen` where 'w' and 'b' are the player ids. */
const at = (fen: string) => new Game('g', 'w', 'b', fen);
const sorted = (r: ReturnType<Game['legalMoves']>) => (r.ok ? [...r.to].sort() : r);

describe('Game.legalMoves', () => {
  const start = () => new Game('g', 'w', 'b');

  it('pawn: single and double step from the start rank', () => {
    expect(sorted(start().legalMoves('w', 'e2'))).toEqual(['e3', 'e4']);
  });

  it('pawn: diagonal captures and en passant', () => {
    // White pawn e5, black just played d7-d5; f6 holds a black knight.
    const game = at('4k3/8/5n2/3pP3/8/8/8/4K3 w - d6 0 2');
    expect(sorted(game.legalMoves('w', 'e5'))).toEqual(['d6', 'e6', 'f6']);
  });

  it('pawn: promotion squares are listed once, not once per promotion piece', () => {
    expect(sorted(at('7k/P7/8/8/8/8/8/K7 w - - 0 1').legalMoves('w', 'a7'))).toEqual(['a8']);
  });

  it('knight: jumps over pieces', () => {
    expect(sorted(start().legalMoves('w', 'g1'))).toEqual(['f3', 'h3']);
  });

  it('bishop: slides diagonally until blocked', () => {
    const game = at('4k3/8/8/8/3B4/8/8/4K3 w - - 0 1');
    expect(sorted(game.legalMoves('w', 'd4'))).toEqual(
      ['a1', 'a7', 'b2', 'b6', 'c3', 'c5', 'e3', 'e5', 'f2', 'f6', 'g1', 'g7', 'h8'].sort(),
    );
  });

  it('rook: slides orthogonally and can capture', () => {
    const game = at('4k3/8/8/3p4/8/8/8/K2R4 w - - 0 1');
    expect(sorted(game.legalMoves('w', 'd1'))).toEqual(
      ['b1', 'c1', 'd2', 'd3', 'd4', 'd5', 'e1', 'f1', 'g1', 'h1'].sort(),
    );
  });

  it('queen: combines rook and bishop movement', () => {
    const game = at('5k2/8/8/8/8/8/7K/Q7 w - - 0 1');
    expect(sorted(game.legalMoves('w', 'a1'))).toHaveLength(7 + 7 + 7);
  });

  it('king: includes castling when legal', () => {
    const game = at('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    expect(sorted(game.legalMoves('w', 'e1'))).toEqual(['c1', 'd1', 'd2', 'e2', 'f1', 'f2', 'g1'].sort());
  });

  it('pinned piece cannot leave the pin line', () => {
    // White knight e2 pinned to the king by the rook on e8.
    expect(sorted(at('4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1').legalMoves('w', 'e2'))).toEqual([]);
  });

  it('in check, only moves that resolve the check are legal', () => {
    // Black queen h4 checks the white king e1; only g3 blocks, the king can't move to f2.
    const game = at('rnb1kbnr/pppp1ppp/8/4p3/7q/5P2/PPPPP1PP/RNBQKBNR w KQkq - 1 3');
    expect(sorted(game.legalMoves('w', 'g2'))).toEqual(['g3']);
    expect(sorted(game.legalMoves('w', 'e1'))).toEqual([]);
  });

  it('empty square and opponent piece have no moves', () => {
    expect(sorted(start().legalMoves('w', 'e4'))).toEqual([]);
    expect(sorted(start().legalMoves('w', 'e7'))).toEqual([]);
  });

  it('rejects requests out of turn, from strangers, or after the game ended', () => {
    const game = start();
    expect(game.legalMoves('b', 'e7')).toEqual({ ok: false, error: 'not_your_turn' });
    expect(game.legalMoves('x', 'e2')).toEqual({ ok: false, error: 'not_a_player' });
    game.resign('w');
    expect(game.legalMoves('w', 'e2')).toEqual({ ok: false, error: 'game_over' });
  });
});

describe('Game.inCheck', () => {
  it('is false at the start and true after a checking move', () => {
    const game = new Game('g', 'w', 'b');
    expect(game.inCheck()).toBe(false);
    game.move('w', { from: 'e2', to: 'e4' });
    game.move('b', { from: 'f7', to: 'f5' });
    const res = game.move('w', { from: 'd1', to: 'h5' });
    expect(res).toMatchObject({ ok: true, san: 'Qh5+', check: true });
    expect(game.inCheck()).toBe(true);
  });

  it('move results report check: false for quiet moves', () => {
    expect(new Game('g', 'w', 'b').move('w', { from: 'e2', to: 'e4' })).toMatchObject({ check: false });
  });
});
