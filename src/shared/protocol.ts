// Wire protocol shared by server and client. All messages are JSON text frames.

export type Color = 'w' | 'b';
export type Promotion = 'q' | 'r' | 'b' | 'n';
export type GameResult = '1-0' | '0-1' | '1/2-1/2';
export type GameOverReason =
  | 'checkmate'
  | 'stalemate'
  | 'threefold_repetition'
  | 'insufficient_material'
  | 'fifty_move_rule'
  | 'resignation'
  | 'abandoned';

export type ClientMessage =
  | { type: 'hello'; name: string; token?: string }
  | { type: 'join_queue' }
  | { type: 'move'; from: string; to: string; promotion?: Promotion }
  | { type: 'legal_moves'; from: string }
  | { type: 'resign' };

export interface GameSnapshot {
  gameId: string;
  color: Color;
  fen: string;
  white: string;
  black: string;
  /** SAN history, so a reconnecting client can rebuild its move list. */
  moves: string[];
  lastMove: [string, string] | null;
  /** Whether the side to move is in check. */
  check: boolean;
  opponentConnected: boolean;
}

export type ServerMessage =
  | { type: 'welcome'; name: string; token: string }
  | { type: 'queued' }
  | ({ type: 'game_start' } & GameSnapshot)
  | { type: 'opponent_status'; connected: boolean }
  | { type: 'move_made'; from: string; to: string; san: string; fen: string; check: boolean }
  | { type: 'legal_moves'; from: string; to: string[] }
  | { type: 'game_over'; result: GameResult; reason: GameOverReason }
  | { type: 'error'; message: string };

const SQUARE = /^[a-h][1-8]$/;
const NAME = /^[\p{L}\p{N} _.-]{1,20}$/u;
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROMOTIONS = new Set<string>(['q', 'r', 'b', 'n']);

/** Returns the trimmed display name, or null if it isn't allowed. */
export function normalizeName(raw: string): string | null {
  const name = raw.trim();
  return NAME.test(name) ? name : null;
}

/** Parses untrusted client input. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const msg = data as Record<string, unknown>;

  switch (msg.type) {
    case 'hello': {
      const name = typeof msg.name === 'string' ? normalizeName(msg.name) : null;
      if (name === null) return null;
      if (msg.token === undefined) return { type: 'hello', name };
      if (typeof msg.token !== 'string' || !TOKEN.test(msg.token)) return null;
      return { type: 'hello', name, token: msg.token };
    }
    case 'join_queue':
      return { type: 'join_queue' };
    case 'resign':
      return { type: 'resign' };
    case 'legal_moves':
      return typeof msg.from === 'string' && SQUARE.test(msg.from) ? { type: 'legal_moves', from: msg.from } : null;
    case 'move': {
      const { from, to, promotion } = msg;
      if (typeof from !== 'string' || !SQUARE.test(from)) return null;
      if (typeof to !== 'string' || !SQUARE.test(to)) return null;
      if (promotion === undefined) return { type: 'move', from, to };
      if (typeof promotion !== 'string' || !PROMOTIONS.has(promotion)) return null;
      return { type: 'move', from, to, promotion: promotion as Promotion };
    }
    default:
      return null;
  }
}
