import { isPromotionMove } from '../shared/board.ts';
import type { Color, Promotion } from '../shared/protocol.ts';

export interface ClickContext {
  inGame: boolean;
  myTurn: boolean;
  myColor: Color;
  selected: string | null;
  board: Map<string, string>;
}

export interface ClickOutcome {
  selected: string | null;
  move?: { from: string; to: string; promotion?: Promotion };
}

function colorOf(piece: string): Color {
  return piece === piece.toUpperCase() ? 'w' : 'b';
}

/** Click-to-move state machine: pick up one of your pieces, then click a destination. */
export function handleSquareClick(ctx: ClickContext, sq: string): ClickOutcome {
  if (!ctx.inGame || !ctx.myTurn) return { selected: null };

  const piece = ctx.board.get(sq);
  if (piece && colorOf(piece) === ctx.myColor) {
    return { selected: sq === ctx.selected ? null : sq };
  }
  if (ctx.selected === null) return { selected: null };

  const moving = ctx.board.get(ctx.selected)!;
  // Bare minimum: always promote to a queen. The server validates legality.
  const move = isPromotionMove(moving, sq)
    ? { from: ctx.selected, to: sq, promotion: 'q' as const }
    : { from: ctx.selected, to: sq };
  return { selected: null, move };
}
