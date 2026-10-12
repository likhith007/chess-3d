import { Chess, type Square } from 'chess.js';
import type { Color, GameOverReason, GameResult, Promotion } from '../shared/protocol.ts';

export interface MoveInput {
  from: string;
  to: string;
  promotion?: Promotion;
}

export interface GameOver {
  result: GameResult;
  reason: GameOverReason;
}

export type MoveError = 'not_a_player' | 'not_your_turn' | 'illegal_move' | 'game_over';

export type MoveResult =
  | { ok: true; from: string; to: string; san: string; fen: string; check: boolean; over: GameOver | null }
  | { ok: false; error: MoveError };

export type LegalMovesResult =
  | { ok: true; to: string[] }
  | { ok: false; error: Exclude<MoveError, 'illegal_move'> };

/** One chess game between two players. Pure domain logic, no I/O. */
export class Game {
  readonly id: string;
  readonly whiteId: string;
  readonly blackId: string;
  private readonly chess: Chess;
  private outcome: GameOver | null = null;

  constructor(id: string, whiteId: string, blackId: string, fen?: string) {
    this.id = id;
    this.whiteId = whiteId;
    this.blackId = blackId;
    this.chess = fen ? new Chess(fen) : new Chess();
  }

  fen(): string {
    return this.chess.fen();
  }

  history(): string[] {
    return this.chess.history();
  }

  lastMove(): [string, string] | null {
    const last = this.chess.history({ verbose: true }).at(-1);
    return last ? [last.from, last.to] : null;
  }

  /** Whether the side to move is in check. */
  inCheck(): boolean {
    return this.chess.inCheck();
  }

  /** Destination squares for the piece on `square`. Only the side to move may ask. */
  legalMoves(playerId: string, square: string): LegalMovesResult {
    const color = this.colorOf(playerId);
    if (color === null) return { ok: false, error: 'not_a_player' };
    if (this.outcome) return { ok: false, error: 'game_over' };
    if (this.chess.turn() !== color) return { ok: false, error: 'not_your_turn' };
    const moves = this.chess.moves({ square: square as Square, verbose: true });
    // Promotions yield one move per piece type; the client only needs each square once.
    return { ok: true, to: [...new Set(moves.map((m) => m.to))] };
  }

  isOver(): boolean {
    return this.outcome !== null;
  }

  colorOf(playerId: string): Color | null {
    if (playerId === this.whiteId) return 'w';
    if (playerId === this.blackId) return 'b';
    return null;
  }

  opponentOf(playerId: string): string | null {
    if (playerId === this.whiteId) return this.blackId;
    if (playerId === this.blackId) return this.whiteId;
    return null;
  }

  move(playerId: string, input: MoveInput): MoveResult {
    const color = this.colorOf(playerId);
    if (color === null) return { ok: false, error: 'not_a_player' };
    if (this.outcome) return { ok: false, error: 'game_over' };
    if (this.chess.turn() !== color) return { ok: false, error: 'not_your_turn' };

    let san: string;
    try {
      san = this.chess.move(input).san;
    } catch {
      // chess.js throws on illegal moves.
      return { ok: false, error: 'illegal_move' };
    }

    this.outcome = this.detectOutcome(color);
    return {
      ok: true,
      from: input.from,
      to: input.to,
      san,
      fen: this.fen(),
      check: this.chess.inCheck(),
      over: this.outcome,
    };
  }

  resign(playerId: string): GameOver | null {
    return this.forfeit(playerId, 'resignation');
  }

  abandon(playerId: string): GameOver | null {
    return this.forfeit(playerId, 'abandoned');
  }

  private forfeit(playerId: string, reason: GameOverReason): GameOver | null {
    const color = this.colorOf(playerId);
    if (color === null || this.outcome) return null;
    this.outcome = { result: color === 'w' ? '0-1' : '1-0', reason };
    return this.outcome;
  }

  private detectOutcome(mover: Color): GameOver | null {
    const c = this.chess;
    if (c.isCheckmate()) return { result: mover === 'w' ? '1-0' : '0-1', reason: 'checkmate' };
    if (c.isStalemate()) return { result: '1/2-1/2', reason: 'stalemate' };
    if (c.isInsufficientMaterial()) return { result: '1/2-1/2', reason: 'insufficient_material' };
    if (c.isThreefoldRepetition()) return { result: '1/2-1/2', reason: 'threefold_repetition' };
    if (c.isDrawByFiftyMoves()) return { result: '1/2-1/2', reason: 'fifty_move_rule' };
    return null;
  }
}
