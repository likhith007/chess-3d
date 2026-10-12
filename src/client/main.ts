import { boardFromFen } from '../shared/board.ts';
import {
  normalizeName,
  type ClientMessage,
  type GameSnapshot,
  type ServerMessage,
} from '../shared/protocol.ts';
import { reconnectDelay } from './reconnect.ts';
import { handleSquareClick } from './selection.ts';

const GLYPHS: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ERROR_TEXT: Record<string, string> = {
  illegal_move: 'Illegal move, try again.',
  not_your_turn: "It's not your turn.",
  not_in_game: 'You are not in a game.',
  already_in_game: 'You are already in a game.',
};
// Must match CLOSE_SESSION_REPLACED in src/server/server.ts.
const CLOSE_SESSION_REPLACED = 4000;
// sessionStorage is per tab and survives a refresh, so two windows can be two different players.
const SESSION_KEY = 'chess.session';
const LAST_NAME_KEY = 'chess.lastName';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loginForm = $<HTMLFormElement>('login');
const nameInput = $<HTMLInputElement>('name-input');
const nameError = $('name-error');
const accountEl = $('account');
const meNameEl = $('me-name');
const gameEl = $('game');
const boardEl = $('board');
const topBar = $('top-bar');
const bottomBar = $('bottom-bar');
const statusEl = $('status');
const movesEl = $('moves');
const playBtn = $<HTMLButtonElement>('play');
const resignBtn = $<HTMLButtonElement>('resign');
const changeNameBtn = $<HTMLButtonElement>('change-name');

interface Session {
  name: string;
  token?: string;
}

interface CurrentGame extends GameSnapshot {
  over: string | null;
}

let session: Session | null = loadSession();
let ws: WebSocket | null = null;
let connected = false;
let reconnectAttempt = 0;
let queued = false;
let game: CurrentGame | null = null;
let selected: string | null = null;
/** Destination squares for `selected`, as reported by the server. */
let legalTargets: string[] = [];
/** Square whose legal moves we asked the server for. */
let pendingFrom: string | null = null;
let notice = '';

function loadSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Session | null;
  } catch {
    return null;
  }
}

function saveSession(s: Session | null): void {
  session = s;
  if (s) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    localStorage.setItem(LAST_NAME_KEY, s.name);
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

// --- connection ---

function connect(): void {
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = socket;
  socket.addEventListener('open', () => {
    if (!session) return;
    send({ type: 'hello', name: session.name, ...(session.token && { token: session.token }) });
  });
  socket.addEventListener('message', (ev) => onMessage(JSON.parse(ev.data as string) as ServerMessage));
  socket.addEventListener('close', (ev) => {
    if (ws !== socket) return; // A socket we deliberately replaced or dropped.
    ws = null;
    connected = false;
    queued = false;
    if (ev.code === CLOSE_SESSION_REPLACED) {
      notice = 'This session was opened in another tab. Refresh to use it here.';
      return render();
    }
    const delay = reconnectDelay(reconnectAttempt++);
    notice = 'Connection lost. Reconnecting…';
    setTimeout(connect, delay);
    render();
  });
}

function disconnect(): void {
  const socket = ws;
  ws = null;
  socket?.close();
}

function send(msg: ClientMessage): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// --- server messages ---

function onMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'welcome':
      saveSession({ name: msg.name, token: msg.token });
      connected = true;
      reconnectAttempt = 0;
      notice = '';
      // A finished game stays on screen; an unfinished one we didn't get resumed is gone.
      if (game && !game.over) game = null;
      break;
    case 'queued':
      queued = true;
      break;
    case 'game_start': {
      const { type: _type, ...snapshot } = msg;
      game = { ...snapshot, over: null };
      queued = false;
      clearSelection();
      notice = '';
      if (game.check) shakeBoard();
      break;
    }
    case 'legal_moves':
      if (msg.from !== pendingFrom) return; // Stale reply for an earlier selection.
      pendingFrom = null;
      selected = msg.from;
      legalTargets = msg.to;
      break;
    case 'opponent_status':
      if (game) game.opponentConnected = msg.connected;
      break;
    case 'move_made':
      if (game) {
        game.fen = msg.fen;
        game.lastMove = [msg.from, msg.to];
        game.moves.push(msg.san);
        game.check = msg.check;
      }
      clearSelection();
      notice = '';
      if (msg.check) shakeBoard();
      break;
    case 'game_over':
      if (game) game.over = `Game over: ${msg.result} (${msg.reason.replaceAll('_', ' ')}).`;
      clearSelection();
      break;
    case 'error':
      pendingFrom = null;
      notice = ERROR_TEXT[msg.message] ?? msg.message;
      break;
  }
  render();
}

// --- rendering ---

function clearSelection(): void {
  selected = null;
  legalTargets = [];
  pendingFrom = null;
}

/** Restarts the shake animation, even if the previous one is still running. */
function shakeBoard(): void {
  boardEl.classList.remove('shake');
  void boardEl.offsetWidth; // Force a reflow so re-adding the class replays the animation.
  boardEl.classList.add('shake');
}

boardEl.addEventListener('animationend', () => boardEl.classList.remove('shake'));

/** Square of the king that is in check, if any. */
function checkedKingSquare(board: Map<string, string>): string | null {
  if (!game?.check) return null;
  const king = game.fen.split(' ')[1] === 'w' ? 'K' : 'k';
  for (const [sq, piece] of board) if (piece === king) return sq;
  return null;
}

function isMyTurn(): boolean {
  return !!game && !game.over && game.fen.split(' ')[1] === game.color;
}

function render(): void {
  loginForm.hidden = session !== null;
  accountEl.hidden = gameEl.hidden = session === null;
  if (!session) return;

  meNameEl.textContent = session.name;
  const inGame = !!game && !game.over;
  changeNameBtn.disabled = inGame;
  playBtn.disabled = !connected || inGame || queued;
  resignBtn.disabled = !connected || !inGame;

  renderPlayers();
  renderBoard();
  movesEl.replaceChildren(
    ...(game?.moves ?? []).map((san) => {
      const li = document.createElement('li');
      li.textContent = san;
      return li;
    }),
  );
  statusEl.textContent = [statusText(), notice].filter(Boolean).join(' ');
}

function statusText(): string {
  if (!connected) return notice ? '' : 'Connecting…';
  if (game?.over) return `${game.over} Press Play for a new game.`;
  if (game && !game.opponentConnected) return 'Opponent disconnected. They have 30 seconds to come back.';
  if (game && game.check) return isMyTurn() ? 'Check! Your move.' : "Check! Opponent's move.";
  if (game) return isMyTurn() ? 'Your move.' : "Opponent's move.";
  if (queued) {
    return 'Waiting for an opponent… Open this page in another window (or send it to a friend) and press Play there.';
  }
  return 'Press Play to find an opponent.';
}

function playerBar(el: HTMLElement, name: string, color: 'w' | 'b', online: boolean, isYou: boolean): void {
  const dot = document.createElement('span');
  dot.className = `dot ${online ? 'online' : 'offline'}`;
  dot.title = online ? 'Connected' : 'Disconnected';
  const label = document.createElement('span');
  label.textContent = `${name}${isYou ? ' (you)' : ''}`;
  const side = document.createElement('span');
  side.className = 'side';
  side.textContent = color === 'w' ? 'White' : 'Black';
  el.replaceChildren(dot, label, side);
  el.classList.toggle('to-move', !!game && !game.over && game.fen.split(' ')[1] === color);
}

function renderPlayers(): void {
  if (!game) {
    topBar.replaceChildren(document.createTextNode('Opponent'));
    topBar.classList.remove('to-move');
    playerBar(bottomBar, session!.name, 'w', connected, true);
    bottomBar.classList.remove('to-move');
    return;
  }
  const opponentColor = game.color === 'w' ? 'b' : 'w';
  const opponentName = opponentColor === 'w' ? game.white : game.black;
  playerBar(topBar, opponentName, opponentColor, game.opponentConnected, false);
  playerBar(bottomBar, session!.name, game.color, connected, true);
}

function renderBoard(): void {
  const myColor = game?.color ?? 'w';
  const board = boardFromFen(game?.fen ?? START_FEN);
  boardEl.classList.toggle('inactive', !game || !!game.over);
  const checked = checkedKingSquare(board);
  const squares: HTMLElement[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      // Flip the board so the player's own pieces are at the bottom.
      const file = myColor === 'w' ? f : 7 - f;
      const rank = myColor === 'w' ? 8 - r : r + 1;
      const sq = `${FILES[file]}${rank}`;
      const piece = board.get(sq);
      const el = document.createElement('div');
      el.className = `sq ${(file + rank) % 2 === 0 ? 'light' : 'dark'}`;
      if (sq === selected) el.classList.add('selected');
      if (game?.lastMove?.includes(sq)) el.classList.add('last');
      if (sq === checked) el.classList.add('check');
      if (legalTargets.includes(sq)) el.classList.add(piece ? 'capture' : 'target');
      if (piece) {
        const span = document.createElement('span');
        span.className = piece === piece.toUpperCase() ? 'w' : 'b';
        span.textContent = GLYPHS[piece.toLowerCase()] ?? '';
        el.append(span);
      }
      el.addEventListener('click', () => onSquareClick(sq, board));
      squares.push(el);
    }
  }
  boardEl.replaceChildren(...squares);
}

// --- user input ---

function onSquareClick(sq: string, board: Map<string, string>): void {
  if (!game) return;
  const outcome = handleSquareClick(
    { inGame: !game.over && connected, myTurn: isMyTurn(), myColor: game.color, selected, board },
    sq,
  );
  if (outcome.move) {
    clearSelection();
    send({ type: 'move', ...outcome.move });
  } else if (outcome.selected === null) {
    clearSelection();
  } else {
    // Ask the server, which is authoritative for the rules, where this piece can go.
    // The selection is shown together with its legal moves when the reply arrives.
    pendingFrom = outcome.selected;
    send({ type: 'legal_moves', from: outcome.selected });
  }
  render();
}

loginForm.addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = normalizeName(nameInput.value);
  nameError.hidden = name !== null;
  if (!name) return;
  saveSession({ name });
  game = null;
  connect();
  render();
});

changeNameBtn.addEventListener('click', () => {
  disconnect();
  saveSession(null);
  connected = queued = false;
  game = null;
  nameInput.value = localStorage.getItem(LAST_NAME_KEY) ?? '';
  render();
  nameInput.focus();
});

playBtn.addEventListener('click', () => {
  if (game?.over) game = null;
  send({ type: 'join_queue' });
});
resignBtn.addEventListener('click', () => send({ type: 'resign' }));

nameInput.value = localStorage.getItem(LAST_NAME_KEY) ?? '';
if (session) connect();
render();
