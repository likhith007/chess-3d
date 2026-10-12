const FILES = 'abcdefgh';

/** Square name (e.g. "e4") -> FEN piece letter (uppercase = white). Empty squares are absent. */
export function boardFromFen(fen: string): Map<string, string> {
  const board = new Map<string, string>();
  const ranks = (fen.split(' ')[0] ?? '').split('/');
  ranks.forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        board.set(`${FILES[file]}${8 - i}`, ch);
        file++;
      }
    }
  });
  return board;
}

export function isPromotionMove(piece: string, to: string): boolean {
  return (piece === 'P' && to[1] === '8') || (piece === 'p' && to[1] === '1');
}
