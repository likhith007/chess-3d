import { describe, expect, it } from 'vitest';
import { Game } from '../../src/server/game.ts';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function newGame() {
  return new Game('g1', 'white-player', 'black-player');
}

describe('Game', () => {
  it('starts at the initial position', () => {
    const game = newGame();
    expect(game.fen()).toBe(START_FEN);
    expect(game.colorOf('white-player')).toBe('w');
    expect(game.colorOf('black-player')).toBe('b');
    expect(game.colorOf('stranger')).toBeNull();
  });

  it('applies a legal move by the side to move', () => {
    const game = newGame();
    const res = game.move('white-player', { from: 'e2', to: 'e4' });
    expect(res).toMatchObject({ ok: true, san: 'e4', over: null });
  });

  it('rejects a move when it is not your turn', () => {
    const game = newGame();
    expect(game.move('black-player', { from: 'e7', to: 'e5' })).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
  });

  it('rejects a move from a non-participant', () => {
    expect(newGame().move('stranger', { from: 'e2', to: 'e4' })).toEqual({
      ok: false,
      error: 'not_a_player',
    });
  });

  it('rejects an illegal move without changing the position', () => {
    const game = newGame();
    expect(game.move('white-player', { from: 'e2', to: 'e5' })).toEqual({
      ok: false,
      error: 'illegal_move',
    });
    expect(game.fen()).toBe(START_FEN);
  });

  it("detects checkmate (fool's mate)", () => {
    const game = newGame();
    game.move('white-player', { from: 'f2', to: 'f3' });
    game.move('black-player', { from: 'e7', to: 'e5' });
    game.move('white-player', { from: 'g2', to: 'g4' });
    const res = game.move('black-player', { from: 'd8', to: 'h4' });
    expect(res).toMatchObject({ ok: true, over: { result: '0-1', reason: 'checkmate' } });
    expect(game.isOver()).toBe(true);
  });

  it('rejects moves after the game is over', () => {
    const game = newGame();
    game.resign('white-player');
    expect(game.move('white-player', { from: 'e2', to: 'e4' })).toEqual({
      ok: false,
      error: 'game_over',
    });
  });

  it('resignation awards the win to the opponent', () => {
    expect(newGame().resign('white-player')).toEqual({ result: '0-1', reason: 'resignation' });
    expect(newGame().resign('black-player')).toEqual({ result: '1-0', reason: 'resignation' });
  });

  it('abandonment awards the win to the opponent', () => {
    expect(newGame().abandon('black-player')).toEqual({ result: '1-0', reason: 'abandoned' });
  });

  it('ignores resign/abandon once over or from strangers', () => {
    const game = newGame();
    expect(game.resign('stranger')).toBeNull();
    game.resign('white-player');
    expect(game.resign('black-player')).toBeNull();
    expect(game.abandon('black-player')).toBeNull();
  });

  it('exposes move history and last move for reconnecting players', () => {
    const game = newGame();
    expect(game.history()).toEqual([]);
    expect(game.lastMove()).toBeNull();
    game.move('white-player', { from: 'e2', to: 'e4' });
    game.move('black-player', { from: 'g8', to: 'f6' });
    expect(game.history()).toEqual(['e4', 'Nf6']);
    expect(game.lastMove()).toEqual(['g8', 'f6']);
  });

  it('handles promotion', () => {
    const game = new Game('g2', 'w', 'b', '8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(game.move('w', { from: 'a7', to: 'a8', promotion: 'q' })).toMatchObject({
      ok: true,
      san: 'a8=Q',
    });
  });

  it('detects stalemate', () => {
    const game = new Game('g3', 'w', 'b', 'k7/8/1Q6/8/8/8/8/K7 w - - 0 1');
    expect(game.move('w', { from: 'b6', to: 'c7' })).toMatchObject({
      ok: true,
      over: { result: '1/2-1/2', reason: 'stalemate' },
    });
  });
});
