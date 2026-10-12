// TODO(future): implement. See docs/TESTING_ROADMAP.md §3.
import { describe, it } from 'vitest';

describe('protocol abuse', () => {
  it.todo('payload larger than maxPayload closes the socket (1009) and forfeits any active game');
  it.todo('binary frames are rejected with bad_message');
  it.todo('message flood from one client is rate-limited and cannot starve other games');
  it.todo('slow consumer (never reads) does not grow server memory unbounded (check bufferedAmount)');
  it.todo('deeply nested / huge JSON inside the size limit is rejected cheaply');
  it.todo('extra unknown fields in messages are ignored, not echoed');
});

describe('game flow races', () => {
  it.todo('both players resign in the same tick: exactly one game_over per player');
  it.todo('move arriving after opponent disconnect returns not_in_game');
  it.todo('player disconnects while queued: never matched with a ghost');
  it.todo('join_queue while already queued is idempotent');
  it.todo('join_queue during a game returns already_in_game');
  it.todo('a player who never moves holds a game forever (needs clocks/idle timeout)');
});

describe('sessions', () => {
  it.todo('both players disconnect: exactly one grace timer forfeits and both sessions are freed');
  it.todo('reconnect in the same tick the grace timer fires: game is either resumed or over, never both');
  it.todo('two tabs repeatedly taking over the same token do not leak sockets or timers');
  it.todo('hello sent twice on one socket returns already_identified');
  it.todo('session-replaced tab (close 4000) does not auto-reconnect');
});

describe('chess rules', () => {
  it.todo('pawn move to last rank without promotion field: behaviour is defined and tested');
  it.todo('promotion field on a non-promotion move is rejected or ignored consistently');
  it.todo('en passant is legal only immediately after the double pawn push');
  it.todo('castling through check / out of check / after rook moved is rejected');
  it.todo('threefold repetition ends the game as a draw');
  it.todo('fifty-move rule ends the game as a draw');
  it.todo('insufficient material (K vs K, K+B vs K, K+N vs K) ends the game');
});
